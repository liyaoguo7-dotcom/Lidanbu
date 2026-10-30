/**
 * 礼单簿 · 额度与会员到期逻辑（T1.5，补强版）
 *
 * 核心公式（集中计算，勿散落各处）：
 *   非会员（含缓冲期/已过期） = 免费额度 + 邀请奖励额度
 *   有效会员（2026-10-25 用户改定，覆盖 2026-10-21「不设业务额度」旧口径）：
 *     有档位（买套餐，membership.planId 有值） = 该档位额度（pricing[].quota）
 *     无档位（后台手动开通等） = 全局会员额度 membership.quota 兜底
 *     两者各项再受防滥用安全上限 safetyCaps 封顶；收礼池仍只来自邀请奖励
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
const AppConfig = require('../config/app-config');

const ZERO_QUOTA = { receiveEvents: 0, recordsPerEvent: 0, receivePool: 0, giftRecords: 0, contacts: 0 };

/**
 * 管理员判定（2026-10-30 管理员免会员批）：读 AppConfig 单例文档的
 * adminIds ∪ addedAdminIds，与 admin.isAdmin 同口径。本模块不 require
 * admin.js（admin.js 反向依赖 quota，会循环），故直接读文档字段。
 * 无 db / 无文档 / 读失败时返回 false（本地演示模式默认非管理员）。
 */
async function isAdminUser(db, userId) {
  if (!db || !userId) return false;
  try {
    const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
    if (!doc) return false;
    const ids = [...(Array.isArray(doc.adminIds) ? doc.adminIds : []), ...(Array.isArray(doc.addedAdminIds) ? doc.addedAdminIds : [])];
    return ids.includes(userId);
  } catch (e) { return false; }
}

/**
 * 五年卡档位额度（管理员免会员口径：管理员一律按最高档五年卡算）。
 * 取静态 pricing 的 fiveYear 档位；取不到则走全局会员额度兜底；仍取不到返回 null。
 */
function fiveYearQuotaFromConfig(config = AppConfig) {
  const plans = (config && config.pricing) || [];
  const plan = plans.find((p) => p && p.id === 'fiveYear');
  const q = plan ? sanitizePlanQuota(plan.quota) : null;
  if (q) return q;
  return sanitizePlanQuota((config && config.membership && config.membership.quota) || {});
}

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
  // 任务AD：api 分发会把调用者 id 放进本参数位（见 payment.resolvePricing 同口径守卫）
  if (typeof config === 'string') config = AppConfig;
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

const PLAN_QUOTA_FIELDS = ['receiveEvents', 'recordsPerEvent', 'giftRecords', 'contacts'];

/**
 * 档位额度消毒：四项齐全且均为 0~1000000 整数才认，返回干净副本；
 * 缺项/非法返回 null（调用方走兜底）。静态配置与老板平台落库共用此口径。
 */
function sanitizePlanQuota(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  const out = {};
  for (const k of PLAN_QUOTA_FIELDS) {
    const v = q[k];
    if (!Number.isInteger(v) || v < 0 || v > 1000000) return null;
    out[k] = v;
  }
  return out;
}

/** 同步口径：从配置对象的 pricing 按用户所持档位取额度（无档位/无额度返回 null） */
function planQuotaFromConfig(user, config = AppConfig) {
  const planId = user && user.membership && user.membership.planId;
  if (!planId) return null;
  const plans = (config && config.pricing) || [];
  const plan = plans.find((p) => p && p.id === planId);
  return plan ? sanitizePlanQuota(plan.quota) : null;
}

/**
 * 异步口径（服务端检查路径用）：生效档位额度，老板平台落库优先。
 * - planId 先看 membership.planId；存量会员没有时回查其最近一笔已支付的
 *   套餐订单推导（kind:'plan'、status:'paid'、createdAt 最大）。
 * - 档位额度取不到（无档位/档位没配额度）→ 全局会员额度兜底：
 *   appConfig 文档 memberQuota 覆盖静态 membership.quota。
 * 非有效会员返回 null（不走会员口径）。
 */
async function resolveMemberBaseQuota(db, user, config = AppConfig, now = Date.now()) {
  if (!db || !user || !isMemberActive(user, now)) return null;
  if (typeof config === 'string') config = AppConfig; // api 分发身份串守卫（同 resolvePricing 口径）
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  let planId = (user.membership && user.membership.planId) || null;
  if (!planId) {
    const orders = await db.collection(COLLECTIONS.Order).find(
      { userId: user._id, kind: 'plan', status: 'paid' },
      { sort: { createdAt: -1 }, limit: 1 }
    );
    if (orders && orders[0] && orders[0].planId) planId = orders[0].planId;
  }
  if (planId) {
    const plans = (doc && Array.isArray(doc.pricing) && doc.pricing.length > 0)
      ? doc.pricing : ((config && config.pricing) || []);
    const plan = plans.find((p) => p && p.id === planId);
    const pq = plan ? sanitizePlanQuota(plan.quota) : null;
    if (pq) return pq;
  }
  const mq = { ...((config && config.membership && config.membership.quota) || {}), ...((doc && doc.memberQuota) || {}) };
  return sanitizePlanQuota(mq);
}

/** 会员是否在有效期内 */
function isMemberActive(user, now = Date.now()) {
  const m = user.membership;
  return !!(m && m.status === 'member' && m.expireAt && now < m.expireAt);
}

/** 【历史兼容】会员额度旧口径：自 2026-10-21 起 getEffectiveQuota 对有效会员
 * 改走 safetyCaps，本函数仅保留给旧调用方/展示口径，新逻辑勿引用。 */
function getMemberQuota(user, config = AppConfig, now = Date.now()) {
  if (isMemberActive(user, now)) {
    const q = config.membership.quota;
    return { receiveEvents: q.receiveEvents || 0, recordsPerEvent: q.recordsPerEvent || 0, receivePool: 0, giftRecords: q.giftRecords || 0, contacts: q.contacts || 0 };
  }
  return { ...ZERO_QUOTA };
}

/**
 * 某用户当前可用额度（2026-10-25 用户改定：会员额度按档位分）：
 * - 有效会员（状态机 member）：按所持档位额度（pricing[].quota，老板平台
 *   逐档可改）；无档位（后台手动开通、或存量推导不出）走全局会员额度
 *   membership.quota 兜底；四项再受防滥用安全上限 config.safetyCaps
 *   （礼薄 1000 / 每薄 5000 / 送礼 10000 / 亲友 5000，界面不展示）封顶。
 *   收礼池仍保留邀请奖励部分（叠加口径便于对账）。
 *   异步检查路径（checkAddQuota）会先经 resolveMemberBaseQuota 按落库
 *   配置解析后经 inviteOpts.planQuota 传入；同步调用方（页面展示）按
 *   membership.planId＋静态 pricing 解析，结果口径一致（落库改价时
 *   展示可能短暂滞后于拦截口径，拦截永远以服务端解析为准）。
 * - 非会员（含 grace 缓冲期与 expired）：免费额度 + 邀请奖励额度，
 *   与既有到期规则一致——到期回落免费口径、超额记录只读、邀请池继续生效。
 * recordsPerEvent：每礼薄上限（邀请不增加此项）
 * receivePool：用户级收礼额度池（邀请奖励来源）
 * @param {object} [inviteOpts] {successfulInvites, settings, planQuota, isAdmin}：
 *   邀请侧入参；缺省成功邀请数按 0 计（同步调用方无 db 时用；带 db 的
 *   检查路径 checkAddQuota 会从发放记录实数并传入）；isAdmin=true 时走
 *   管理员免会员口径（2026-10-30：管理员视同会员、额度按五年卡算）。
 */
function getEffectiveQuota(user, config = AppConfig, now = Date.now(), inviteOpts = {}) {
  const free = config.freeQuota;
  const invite = getInviteRewardQuota(
    user && user._id,
    inviteOpts.successfulInvites || 0,
    inviteOpts.settings || inviteSettingsFromConfig(config)
  );
  // 管理员免会员（2026-10-30）：管理员走会员分支、额度按最高档（五年卡）算，
  // 与是否持有真实会员无关；普通用户口径一字不动。
  const adminExempt = inviteOpts.isAdmin === true;
  if (user && (isMemberActive(user, now) || adminExempt)) {
    const caps = config.safetyCaps || { books: 1000, perBook: 5000, giftRecords: 10000, contacts: 5000 };
    const base = inviteOpts.planQuota !== undefined && inviteOpts.planQuota !== null
      ? inviteOpts.planQuota
      : (adminExempt ? (fiveYearQuotaFromConfig(config) || {}) : (planQuotaFromConfig(user, config) || sanitizePlanQuota((config.membership || {}).quota) || {}));
    const cap = (v, c) => Math.min(Number.isInteger(v) ? v : 0, c);
    return {
      receiveEvents: cap(base.receiveEvents, caps.books),
      recordsPerEvent: cap(base.recordsPerEvent, caps.perBook),
      receivePool: invite.receivePool || 0,
      giftRecords: cap(base.giftRecords, caps.giftRecords),
      contacts: cap(base.contacts, caps.contacts),
    };
  }
  const member = getMemberQuota(user, config, now); // 非有效会员恒为 0（保留旧公式衔接）
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
  // 会员档位额度（落库优先，含存量订单推导与无档位兜底）
  // 管理员免会员（2026-10-30）：管理员一律按五年卡额度算，不读其真实档位。
  const isAdmin = await isAdminUser(db, user._id);
  let planQuota = await resolveMemberBaseQuota(db, user, config, now);
  if (isAdmin) planQuota = fiveYearQuotaFromConfig(config) || planQuota;
  const quota = getEffectiveQuota(user, config, now, { successfulInvites, settings, planQuota, isAdmin });
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
  isAdminUser,
  fiveYearQuotaFromConfig,
  getMemberQuota,
  sanitizePlanQuota,
  planQuotaFromConfig,
  resolveMemberBaseQuota,
  getEffectiveQuota,
  getMembershipState,
  getReminderSchedule,
  checkAddQuota,
  checkEditAllowed,
  isOverFreeQuota,
  computePoolUsed,
  ZERO_QUOTA,
};
