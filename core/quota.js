/**
 * 礼单簿 · 额度与会员到期逻辑（T1.5）
 *
 * 核心公式（集中计算，勿散落各处）：
 *   某用户当前可用额度 = 免费额度 + 会员额度 + 邀请奖励额度
 *
 * 预留：邀请奖励额度规则待用户确定，当前 getInviteRewardQuota 固定返回 0；
 *      邀请功能本身本阶段不做。AppConfig.inviteReward 已预留配置位。
 *
 * v3.1 §15.3：额度用完拦截新增（旧记录不删）；会员到期后超额记录只读；
 * 缓冲期约90天；三次温和提醒（到期前15天、到期当天、缓冲期结束前）。
 */

const { COLLECTIONS } = require('./models');
const AppConfig = require('../miniprogram/config/app-config');

const ZERO_QUOTA = { receiveEvents: 0, recordsPerEvent: 0, giftRecords: 0, contacts: 0 };

/**
 * 邀请奖励额度（预留）
 * 规则待用户确定；当前固定返回 0。邀请功能本阶段不做。
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
  if (isMemberActive(user, now)) return { ...config.membership.quota };
  return { ...ZERO_QUOTA };
}

/**
 * 某用户当前可用额度 = 免费额度 + 会员额度 + 邀请奖励额度
 */
function getEffectiveQuota(user, config = AppConfig, now = Date.now()) {
  const free = config.freeQuota;
  const member = getMemberQuota(user, config, now);
  const invite = getInviteRewardQuota(user._id);
  return {
    receiveEvents: free.receiveEvents + member.receiveEvents + invite.receiveEvents,
    recordsPerEvent: free.recordsPerEvent + member.recordsPerEvent + invite.recordsPerEvent,
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

/**
 * 新增前额度检查：用完拦截新增，旧记录不删
 * @returns {{ok:boolean, reason:string}}
 */
async function checkAddQuota(db, user, kind, config = AppConfig, eventId, now = Date.now()) {
  const quota = getEffectiveQuota(user, config, now);
  const used = await countUsage(db, user._id, kind, eventId);
  const limit = { event: quota.receiveEvents, receiveRecord: quota.recordsPerEvent, gift: quota.giftRecords, contact: quota.contacts }[kind];
  if (used >= limit) return { ok: false, reason: `quota-exceeded:${kind}` };
  return { ok: true, reason: 'ok' };
}

/**
 * 判断一条已存在记录是否"超出免费额度"（会员到期后只读用）
 * 按 createdAt 排序，前 N（免费额度）条为免费额度内，其余为超额。
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
  ZERO_QUOTA,
};
