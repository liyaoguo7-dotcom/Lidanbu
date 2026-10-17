/**
 * 礼单簿 · 额度与会员到期逻辑（T1.5，补强版）
 *
 * 核心公式（集中计算，勿散落各处）：
 *   某用户当前可用额度 = 免费额度 + 会员额度 + 邀请奖励额度
 *
 * 邀请奖励（规则用户 2026-10-18 已确认，功能未开发，当前固定返回 0）：
 * - 成功邀请一人：收礼额度池 +10（用户级，所有礼薄合计；不增加每礼薄上限，
 *   不增加礼薄个数）；送礼额度 +5
 * - 生效条件：新用户经邀请进入 && (新建1礼薄+1收礼联系人 || 1送礼联系人)
 * - 上限：先按最多 10 个成功邀请预留（含义待确认）；数字全放配置
 *
 * 收礼额度池语义：每个礼薄仍是免费/会员的 30 条上限；某个礼薄超过自己的
 * 上限后，可从用户级池里消耗。池消耗量 = 各礼薄 (记录数 - 每礼薄上限) 的正部之和。
 *
 * v3.1 §15.3：额度用完拦截新增（旧记录不删）；会员到期后超额记录只读；
 * 缓冲期30天（用户2026-10-18确认）；三次温和提醒（到期前15天、到期当天、缓冲期结束前）。
 */
const errors = require('./errors');

const { COLLECTIONS } = require('./models');
const AppConfig = require('../config/app-config');

const ZERO_QUOTA = { receiveEvents: 0, recordsPerEvent: 0, receivePool: 0, giftRecords: 0, contacts: 0 };

/**
 * 邀请奖励额度（预留）
 * 规则已确认但功能未开发；当前固定返回 0。
 * 启用后：按 AppConfig.inviteReward.rules 计算
 *   receivePool = perInvite.receivePool × min(成功邀请数, maxInvites)
 *   giftRecords = perInvite.giftRecords × min(成功邀请数, maxInvites)
 *   receiveEvents 不增加（礼薄个数不随邀请增加）
 */
function getInviteRewardQuota(/* userId */) {
  return { ...ZERO_QUOTA };
}

/** 会员是否在有效期内 */
function isMemberActive(user, now = Date.now()) {
  const m = user.membership;
  return !!(m && m.status === 'member' && m.expireAt && now < m.expireAt);
}

/** 会员额度：有效期内返回配置的会员额度，否则 0 */
function getMemberQuota(user, config = AppConfig, now = Date.now()) {
  if (isMemberActive(user, now)) {
    const q = config.membership.quota;
    return { receiveEvents: q.receiveEvents || 0, recordsPerEvent: q.recordsPerEvent || 0, receivePool: 0, giftRecords: q.giftRecords || 0, contacts: q.contacts || 0 };
  }
  return { ...ZERO_QUOTA };
}

/**
 * 某用户当前可用额度 = 免费额度 + 会员额度 + 邀请奖励额度
 * recordsPerEvent：每礼薄上限（邀请不增加此项）
 * receivePool：用户级收礼额度池（邀请奖励来源，当前 0）
 */
function getEffectiveQuota(user, config = AppConfig, now = Date.now()) {
  const free = config.freeQuota;
  const member = getMemberQuota(user, config, now);
  const invite = getInviteRewardQuota(user._id);
  return {
    receiveEvents: free.receiveEvents + member.receiveEvents + invite.receiveEvents,
    recordsPerEvent: free.recordsPerEvent + member.recordsPerEvent,
    receivePool: (member.receivePool || 0) + (invite.receivePool || 0),
    giftRecords: free.giftRecords + member.giftRecords + invite.giftRecords,
    contacts: free.contacts + member.contacts + invite.contacts,
  };
}

/**
 * 会员状态：free | member | grace(过期缓冲期) | expired(缓冲期已过)
 */
function getMembershipState(user, config = AppConfig, now = Date.now()) {
  const m = user.membership || { status: 'free' };
  if (m.status === 'member' && m.expireAt && now < m.expireAt) return 'member';
  if (m.expireAt) {
    const graceUntil = m.expireAt + config.membership.expiry.gracePeriodDays * 86400e3;
    if (now < graceUntil) return 'grace';
    return 'expired';
  }
  return 'free';
}

/**
 * 三次提醒的触发时间点（时间戳数组）
 * 到期前15天、到期当天、缓冲期结束前3天（"结束前"具体天数未定，取3天，见报告）
 */
function getReminderSchedule(user, config = AppConfig) {
  const m = user.membership;
  if (!m || !m.expireAt) return [];
  const day = 86400e3;
  const graceUntil = m.expireAt + config.membership.expiry.gracePeriodDays * day;
  return [
    m.expireAt - 15 * day, // 到期前15天
    m.expireAt,            // 到期当天
    graceUntil - 3 * day,  // 缓冲期结束前
  ];
}

/** 取某类当前已用数量 */
async function countUsage(db, ownerId, kind, eventId) {
  if (kind === 'event') return db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId });
  if (kind === 'receiveRecord') return db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId, eventId });
  if (kind === 'gift') return db.collection(COLLECTIONS.GiftRecord).count({ ownerId });
  if (kind === 'contact') return db.collection(COLLECTIONS.Contact).count({ ownerId });
  throw new Error(`未知额度种类:${kind}`);
}

/** 池已消耗量 = 各礼薄 (记录数 - 每礼薄上限) 的正部之和 */
async function computePoolUsed(db, ownerId, perEventLimit) {
  const events = await db.collection(COLLECTIONS.ReceiveEvent).find({ ownerId });
  let used = 0;
  for (const e of events) {
    const n = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId, eventId: e._id });
    used += Math.max(0, n - perEventLimit);
  }
  return used;
}

/** 收礼明细新增检查：先每礼薄上限，超了再从用户级池消耗 */
async function checkAddReceiveRecord(db, ownerId, eventId, quota) {
  const inEvent = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId, eventId });
  if (inEvent < quota.recordsPerEvent) return { ok: true, reason: 'within-event-quota' };
  const poolTotal = quota.receivePool || 0;
  if (poolTotal <= 0) return { ok: false, reason: 'quota-exceeded:receiveRecord' };
  const poolUsed = await computePoolUsed(db, ownerId, quota.recordsPerEvent);
  if (poolUsed >= poolTotal) return { ok: false, reason: 'quota-exceeded:receivePool' };
  return { ok: true, reason: 'from-receive-pool' };
}

/**
 * 新增前额度检查：用完拦截新增，旧记录不删
 * @returns {{ok:boolean, reason:string}}
 */
async function checkAddQuota(db, user, kind, config = AppConfig, eventId, now = Date.now()) {
  const quota = getEffectiveQuota(user, config, now);
  if (kind === 'receiveRecord') {
    return checkAddReceiveRecord(db, user._id, eventId, quota);
  }
  const used = await countUsage(db, user._id, kind, eventId);
  const limit = { event: quota.receiveEvents, gift: quota.giftRecords, contact: quota.contacts }[kind];
  if (limit === undefined) throw new Error(`未知额度种类:${kind}`);
  if (used >= limit) return { ok: false, reason: `quota-exceeded:${kind}` };
  return { ok: true, reason: 'ok' };
}

/**
 * 判断一条已存在记录是否"超出免费额度"（会员到期后只读用）
 * 按 createdAt 排序，前 N（免费额度）条为免费额度内，其余为超额。
 * 池消耗的记录排在后面，自然落入超额区 → 到期后只读。
 */
async function isOverFreeQuota(db, ownerId, kind, recordId, config = AppConfig) {
  const free = config.freeQuota;
  let col, query, limit;
  if (kind === 'event') { col = COLLECTIONS.ReceiveEvent; query = { ownerId }; limit = free.receiveEvents; }
  else if (kind === 'receiveRecord') {
    const rec = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: recordId });
    if (!rec) return false;
    col = COLLECTIONS.ReceiveRecord; query = { ownerId, eventId: rec.eventId }; limit = free.recordsPerEvent;
  }
  else if (kind === 'gift') { col = COLLECTIONS.GiftRecord; query = { ownerId }; limit = free.giftRecords; }
  else if (kind === 'contact') { col = COLLECTIONS.Contact; query = { ownerId }; limit = free.contacts; }
  else throw new Error(`未知额度种类:${kind}`);

  const all = await db.collection(col).find(query, { sort: { createdAt: 1 } });
  const idx = all.findIndex((d) => d._id === recordId);
  if (idx === -1) return false;
  return idx >= limit;
}

/**
 * 修改前检查：会员到期后，超额记录只读（可查可导出，不能改）
 * @returns {{ok:boolean, reason:string}}
 */
async function checkEditAllowed(db, user, kind, recordId, config = AppConfig, now = Date.now()) {
  if (isMemberActive(user, now)) return { ok: true, reason: 'member-active' };
  const over = await isOverFreeQuota(db, user._id, kind, recordId, config);
  if (over) return { ok: false, reason: 'readonly:over-free-quota-after-expiry' };
  return { ok: true, reason: 'within-free-quota' };
}

module.exports = {
  getInviteRewardQuota,
  isMemberActive,
  getMemberQuota,
  getEffectiveQuota,
  getMembershipState,
  getReminderSchedule,
  checkAddQuota,
  checkEditAllowed,
  isOverFreeQuota,
  computePoolUsed,
  ZERO_QUOTA,
};
