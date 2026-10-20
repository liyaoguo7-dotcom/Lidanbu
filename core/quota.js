/**
 * 礼单簿 · 额度与会员到期逻辑（T1.5，补强版）
 *
 * 核心公式（集中计算，勿散落各处）：
 *   某用户当前可用额度 = 免费额度 + 会员额度 + 邀请奖励额度
 *
 * 邀请奖励（用户 2026-10-20 决定正式开启，规则见 core/invite-reward.js）：
 * - 成功邀请一人：收礼额度池 +10（用户级，所有礼薄合计；不增加每礼薄上限，
 *   不增加礼薄个数）；送礼额度 +5
 * - 生效条件：新用户经邀请码绑定 && (新建≥1礼薄+≥1收礼记录 || ≥1送礼记录)
 * - 上限：maxSuccessfulInvites（每个邀请人最多计入的成功邀请次数，默认 10，
 *   含义待用户最终确认）；数字全放配置，老板平台可覆盖（appConfig 文档）
 *
 * 收礼额度池语义：每个礼薄仍是免费/会员的 30 条上限；某个礼薄超过自己的
 * 上限后，可从用户级池里消耗。池消耗量 = 各礼薄 (记录数 - 每礼薄上限) 的正部之和。
 *
 * v3.1 §15.3：额度用完拦截新增（旧记录不删）；会员到期后超额记录只读；
 * 缓冲期30天（用户2026-10-18确认）；三次温和提醒（到期前15天、到期当天、缓冲期结束前）。
 */
const errors = require('./errors');

const { COLLECTIONS } = require('./models');
const AppConfig = require('../miniprogram/config/app-config');

const ZERO_QUOTA = { receiveEvents: 0, recordsPerEvent: 0, receivePool: 0, giftRecords: 0, contacts: 0 };

/**
 * 从静态配置对象提取邀请奖励设置（统一口径，供各处复用）
 * @returns {{enabled:boolean, perInvite:{receivePool:number, giftRecords:number}, maxSuccessfulInvites:number}}
 */
function inviteSettingsFromConfig(config = AppConfig) {
  const ir = (config && config.inviteReward) || {};
  const rules = ir.rules || {};
  const per = rules.perInvite || {};
  return {
    enabled: !!ir.enabled,
    perInvite: {
      receivePool: Number.isInteger(per.receivePool) ? per.receivePool : 10,
      giftRecords: Number.isInteger(per.giftRecords) ? per.giftRecords : 5,
    },
    maxSuccessfulInvites:
      (Number.isInteger(rules.maxSuccessfulInvites) ? rules.maxSuccessfulInvites : rules.maxInvites) ?? 10,
  };
}

/**
 * 生效的邀请奖励设置：静态配置为默认，云数据库 appConfig 文档的
 * inviteReward 段（老板平台写入）逐项覆盖。与 admin.js 配置口径一致：
 * 文档未写过的项回退静态默认。
 */
async function resolveInviteSettings(db, config = AppConfig) {
  const base = inviteSettingsFromConfig(config);
  if (!db) return base;
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  const over = (doc && doc.inviteReward) || null;
  if (!over) return base;
  return {
    enabled: over.enabled !== undefined ? !!over.enabled : base.enabled,
    perInvite: { ...base.perInvite, ...(over.perInvite || {}) },
    maxSuccessfulInvites:
      Number.isInteger(over.maxSuccessfulInvites) ? over.maxSuccessfulInvites : base.maxSuccessfulInvites,
  };
}

/** 某邀请人的成功邀请次数（= 已发放记录数，发放记录是唯一真源） */
async function countSuccessfulInvites(db, userId) {
  return db.collection(COLLECTIONS.InviteRewardGrant).count({ userId });
}

/**
 * 邀请奖励额度（按成功邀请次数计算，纯函数）
 *   receivePool = perInvite.receivePool × min(成功邀请数, maxSuccessfulInvites)
 *   giftRecords = perInvite.giftRecords × min(成功邀请数, maxSuccessfulInvites)
 *   receiveEvents 不增加（礼薄个数不随邀请增加）；contacts/recordsPerEvent 不增加
 * 开关关闭或成功邀请数为 0 时返回全 0。
 * @param {string} userId 邀请人（仅作签名占位，计算只看次数）
 * @param {number} successfulInvites 成功邀请次数（由调用方从发放记录计数后传入）
 * @param {object} [settings] 生效设置，缺省读静态配置
 */
function getInviteRewardQuota(userId, successfulInvites = 0, settings = null) {
  const s = settings || inviteSettingsFromConfig(AppConfig);
  if (!s.enabled) return { ...ZERO_QUOTA };
  const n = Math.max(0, Math.min(Math.floor(Number(successfulInvites) || 0), s.maxSuccessfulInvites));
  return {
    ...ZERO_QUOTA,
    receivePool: s.perInvite.receivePool * n,
    giftRecords: s.perInvite.giftRecords * n,
  };
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
 * receivePool：用户级收礼额度池（邀请奖励来源）
 * @param {object} [inviteOpts] {successfulInvites, settings}：邀请侧入参；
 *   缺省成功邀请数按 0 计（同步调用方无 db 时用；带 db 的检查路径
 *   checkAddQuota 会从发放记录实数并传入，老板平台覆盖的设置经 settings 传入）
 */
function getEffectiveQuota(user, config = AppConfig, now = Date.now(), inviteOpts = {}) {
  const free = config.freeQuota;
  const member = getMemberQuota(user, config, now);
  const invite = getInviteRewardQuota(
    user && user._id,
    inviteOpts.successfulInvites || 0,
    inviteOpts.settings || inviteSettingsFromConfig(config)
  );
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
  // 邀请奖励实数：从发放记录计成功邀请数，并读老板平台覆盖后的生效设置
  const successfulInvites = await countSuccessfulInvites(db, user._id);
  const settings = await resolveInviteSettings(db, config);
  const quota = getEffectiveQuota(user, config, now, { successfulInvites, settings });
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
  inviteSettingsFromConfig,
  resolveInviteSettings,
  countSuccessfulInvites,
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
