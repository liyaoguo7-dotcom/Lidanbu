/**
 * 礼单簿 · 积分账户（用户 2026-10-21 确认口径，高风险：扣费/返还/对账）
 *
 * 规则：
 * - 积分不过期；会员到期后余额保留，续费后继续可用（积分与会员状态互不绑定）。
 * - 余额真源：流水集合 pointsLedger；User.pointsBalance 是同口径的缓存值，
 *   每次记账顺序写「先流水、后余额」保证两者一致。本地 MemoryDB 下顺序
 *   await 即一致；★云端联调时 grant/spend/refund 必须放进数据库事务，
 *   或用余额字段的原子自增 + 流水补偿对账，勿拆成无事务的两次独立写。
 * - 幂等铁律：同一 (userId, kind, refId) 只入账一次。grant/spend 重复调用
 *   （重复点击、重复回调、网络重试）返回首次结果并标 duplicated:true，
 *   绝不多加/多扣；refund 以「原 refId + ':refund'」为冲正键，只退一次、
 *   金额不得超过原扣。
 * - 数字全部读配置：AppConfig.points（老板平台 appConfig 文档 points 段可覆盖）。
 */
const { COLLECTIONS, now } = require('./models');
const AppConfig = require('../miniprogram/config/app-config');
const errors = require('./errors');

function pointsSettingsFromConfig(config = AppConfig) {
  const p = (config && config.points) || {};
  return {
    registerGrant: Number.isInteger(p.registerGrant) ? p.registerGrant : 15,
    photoImportCost: Number.isInteger(p.photoImportCost) ? p.photoImportCost : 2,
    packs: Array.isArray(p.packs) ? p.packs : [],
  };
}

/** 生效积分设置：静态配置为默认，appConfig 文档 points 段逐项覆盖（与邀请奖励同口径） */
async function resolvePointsSettings(db, config = AppConfig) {
  // 任务AD：api 分发会把调用者 id 放进本参数位（见 payment.resolvePricing 同口径守卫）
  if (typeof config === 'string') config = AppConfig;
  const base = pointsSettingsFromConfig(config);
  if (!db) return base;
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  const over = (doc && doc.points) || null;
  if (!over) return base;
  return {
    registerGrant: Number.isInteger(over.registerGrant) ? over.registerGrant : base.registerGrant,
    photoImportCost: Number.isInteger(over.photoImportCost) ? over.photoImportCost : base.photoImportCost,
    packs: Array.isArray(over.packs) ? over.packs : base.packs,
  };
}

async function loadUser(db, userId) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  if (!user) {
    const e = new Error('用户不存在，请重新登录');
    e.code = 'user-not-found';
    throw e;
  }
  return user;
}

function checkAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw errors.pointsDenied('points-amount-invalid');
}

async function findEntry(db, userId, kind, refId) {
  if (refId === undefined || refId === null || refId === '') return null;
  return db.collection(COLLECTIONS.PointsLedger).findOne({ userId, kind, refId });
}

/**
 * 记账串行锁（按用户）：同一用户的 grant/spend/refund/reverseGrant 排队执行，
 * 杜绝并发下「先查幂等键未命中、再各记一笔」的竞态（本地存储/单进程运行时
 * 的真实并发来源：重复点击、回调与重试交叠）。云端多实例仍须按文件头说明
 * 上数据库事务/唯一约束，本锁不替代云端约束。
 */
const _ledgerLocks = new Map();
function withLedgerLock(userId, fn) {
  const prev = _ledgerLocks.get(userId) || Promise.resolve();
  const next = prev.then(() => fn());
  _ledgerLocks.set(userId, next.catch(() => {}));
  return next;
}

/** 记一笔流水并同步余额（顺序写，见文件头事务说明）。返回流水文档 */
async function appendEntry(db, userId, delta, kind, refId, note) {
  const user = await loadUser(db, userId);
  const balanceAfter = (user.pointsBalance || 0) + delta;
  const doc = {
    userId,
    delta,
    balanceAfter,
    kind,
    refId: refId || '',
    note: note || '',
    createdAt: now(),
  };
  const { _id } = await db.collection(COLLECTIONS.PointsLedger).insert(doc);
  await db.collection(COLLECTIONS.User).update({ _id: userId }, { pointsBalance: balanceAfter });
  return { ...doc, _id };
}

/** 当前积分余额（用户记录上的 pointsBalance，与流水同口径维护） */
async function getBalance(db, userId) {
  const user = await loadUser(db, userId);
  return user.pointsBalance || 0;
}

/**
 * 入账（赠送/购买/返还之外的正向变动）。幂等：同一 (userId,kind,refId)
 * 只入账一次，重复调用返回 {duplicated:true} 与首次流水，不重复加。
 * @returns {{ok:true, duplicated:boolean, balance:number, entry:object}}
 */
async function grantUnlocked(db, userId, amount, { kind = 'manual', refId = '', note = '' } = {}) {
  checkAmount(amount);
  const dup = await findEntry(db, userId, kind, refId);
  if (dup) return { ok: true, duplicated: true, balance: await getBalance(db, userId), entry: dup };
  const entry = await appendEntry(db, userId, amount, kind, refId, note);
  return { ok: true, duplicated: false, balance: entry.balanceAfter, entry };
}

/**
 * 消耗。余额不足抛 errors.insufficientPoints（委婉文案），余额与流水不变。
 * 幂等同 grant：同 refId 只扣一次（同一次拍照任务/jobId 重复提交不多扣）。
 */
async function spendUnlocked(db, userId, amount, { kind = 'manual', refId = '', note = '' } = {}) {
  checkAmount(amount);
  const dup = await findEntry(db, userId, kind, refId);
  if (dup) return { ok: true, duplicated: true, balance: await getBalance(db, userId), entry: dup };
  const balance = await getBalance(db, userId);
  if (balance < amount) throw errors.pointsDenied('insufficient-points');
  const entry = await appendEntry(db, userId, -amount, kind, refId, note);
  return { ok: true, duplicated: false, balance: entry.balanceAfter, entry };
}

/**
 * 返还（拍照识别失败/额度拦截时冲正）：以原消費 refId 定位原扣，
 * 冲正流水 kind='photo_refund'、refId=原 refId+':refund'。
 * 只许退一次；金额不得超过原扣（原扣 = 该 refId 下负流水的绝对值，
 * 以 kind='photo_import' 优先匹配，找不到再认任意负流水）。
 */
async function refundUnlocked(db, userId, amount, { refId = '', note = '' } = {}) {
  checkAmount(amount);
  if (!refId) throw errors.pointsDenied('points-refund-not-found');
  const refundRefId = `${refId}:refund`;
  const dup = await findEntry(db, userId, 'photo_refund', refundRefId);
  if (dup) return { ok: true, duplicated: true, balance: await getBalance(db, userId), entry: dup };
  const originals = await db.collection(COLLECTIONS.PointsLedger).find({ userId, refId });
  const original = originals.find((e) => e.kind === 'photo_import' && e.delta < 0)
    || originals.find((e) => e.delta < 0);
  if (!original) throw errors.pointsDenied('points-refund-not-found');
  if (amount > -original.delta) throw errors.pointsDenied('points-refund-exceeds');
  const entry = await appendEntry(db, userId, amount, 'photo_refund', refundRefId, note);
  return { ok: true, duplicated: false, balance: entry.balanceAfter, entry };
}

/**
 * 退款回收套餐赠送积分（payment.refund 调用）：冲正流水
 * kind='plan_grant_reversal'、refId=订单号+':reversal'，幂等只回收一次。
 * 调用方须先判断余额是否足够（不足时只写审计不强扣，口径在 payment 侧）。
 */
async function reverseGrantUnlocked(db, userId, amount, { refId = '', note = '', reversalKind = 'plan_grant_reversal' } = {}) {
  checkAmount(amount);
  const reversalRefId = `${refId}:reversal`;
  const dup = await findEntry(db, userId, reversalKind, reversalRefId);
  if (dup) return { ok: true, duplicated: true, balance: await getBalance(db, userId), entry: dup };
  const entry = await appendEntry(db, userId, -amount, reversalKind, reversalRefId, note);
  return { ok: true, duplicated: false, balance: entry.balanceAfter, entry };
}

/**
 * 注册赠送：新用户首次创建时调用。refId='register:'+userId 固定，
 * 重复初始化（重复调用）只发一次。金额读配置，配置为 0 时跳过。
 */
async function grantRegisterBonus(db, userId, config = AppConfig) {
  const settings = await resolvePointsSettings(db, config);
  if (!settings.registerGrant || settings.registerGrant <= 0) {
    return { ok: true, skipped: true, balance: await getBalance(db, userId) };
  }
  return grant(db, userId, settings.registerGrant, {
    kind: 'register_grant',
    refId: `register:${userId}`,
    note: '新用户注册赠送',
  });
}

/** 我的积分流水（倒序：最新在上；字段含来源/消耗/时间/订单号 refId，可对账） */
async function listLedger(db, userId, { limit = 100 } = {}) {
  const all = await db.collection(COLLECTIONS.PointsLedger).find({ userId });
  // find 返回插入序；先整体翻转再按时间倒序稳定排序，同毫秒内后记的在前
  return all.reverse().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** 对外记账入口：统一过按用户串行锁（见 withLedgerLock 说明） */
async function grant(db, userId, amount, opts) {
  return withLedgerLock(userId, () => grantUnlocked(db, userId, amount, opts));
}
async function spend(db, userId, amount, opts) {
  return withLedgerLock(userId, () => spendUnlocked(db, userId, amount, opts));
}
async function refund(db, userId, amount, opts) {
  return withLedgerLock(userId, () => refundUnlocked(db, userId, amount, opts));
}
async function reverseGrant(db, userId, amount, opts) {
  return withLedgerLock(userId, () => reverseGrantUnlocked(db, userId, amount, opts));
}

module.exports = {
  pointsSettingsFromConfig,
  resolvePointsSettings,
  getBalance,
  grant,
  spend,
  refund,
  reverseGrant,
  grantRegisterBonus,
  listLedger,
};
