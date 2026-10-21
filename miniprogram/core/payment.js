/**
 * 礼单簿 · 支付与会员订单（任务K，高风险模块）
 *
 * 价格真源（页面与下单都不得写死价格）：
 *   生效档位 = 老板平台 appConfig 文档 pricing 段（非空时优先）
 *            → 静态配置 AppConfig.pricing（占位价，待用户定价）。
 *   下单时把档位的 priceFen / days 快照进订单，之后改价不影响已下单。
 *
 * 支付链路（与真实通道同构，通道差异收在 core/pay-adapter.js）：
 *   createOrder 建单(pending) → adapter.requestPay 调起支付
 *   → 成功后经"回调"入口 processNotify/handleNotify 验单发货；
 *   前端结果不直接发货，发货只认回调（真实通道为平台发货推送）。
 *
 * 发货（会员续期）规则 —— 与老板平台手工开通 admin.setMemberPlan 同一口径：
 *   base = max(当前时刻, 现有 expireAt)；newExpireAt = base + days。
 *   即：未到期从原到期日叠加；已过期从今天起算；缓冲期(grace)内续费
 *   因 expireAt 已过，同样从今天起算，续费成功状态立即回到 member，
 *   到期共享暂停等状态由 quota 现行逻辑随 expireAt 自动恢复。
 *
 * 幂等与安全：
 * - 同一 outTradeNo 的重复回调只发货一次：订单已 paid 时直接返回
 *   {ok:true, duplicated:true}，不再续期；
 * - 回调金额以订单快照为准，不一致 → 拒绝发货、订单保持 pending、写审计；
 * - 订单只对本人可见：listOrders 按 userId 过滤，getOrderForUser 越权拒绝。
 *
 * 退款（占位，真实退款待支付接入）：
 *   refund 只把订单置 refunded 并回收会员时长、写审计，不产生真实退款。
 *   时长回收规则（按未消耗整期回收）：本单发货时段 = [baseAt, deliveredExpireAt]；
 *   未消耗时长 = deliveredExpireAt − max(退款时刻, baseAt)；只回收其中的
 *   整天数（不足 1 天的零头不回收），且回收后 expireAt 不低于本单发货前
 *   的 prevExpireAt（不吃掉更早订单的时段）。
 *
 * 到期提醒：判定与分发已由任务L在 core/notify.js 实现
 *   checkMembershipReminders(db, userId) —— 经 notify(db, userId, type,
 *   payload) 适配层发送（站内通知落库 + 订阅消息骨架），以
 *   dedupeKey=类型+到期日 去重。本模块只负责把 membership.expireAt
 *   在发货/退款时正确更新，提醒侧读最新到期日自动进入新一轮周期。
 */
const { COLLECTIONS, now } = require('./models');
const AppConfig = require('../config/app-config');
const audit = require('./audit');
const errors = require('./errors');

const DAY = 86400e3;
let tradeSeq = 0;

function payError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** 业务单号：LD + 时间与序号/随机混合，保证唯一（8~32 位、不以下划线开头，与个人通道文档的 outTradeNo 规则一致） */
function genOutTradeNo(nowTs) {
  tradeSeq = (tradeSeq + 1) % 1296;
  const rand = Math.floor(Math.random() * 1296);
  return `LD${nowTs.toString(36)}${tradeSeq.toString(36)}${rand.toString(36)}`.toUpperCase();
}

/**
 * 生效价格档位：老板平台配置（appConfig 文档 pricing 非空）优先，
 * 否则静态配置占位档。返回干净副本 [{id, name, priceFen, days}]。
 */
async function resolvePricing(db, config = AppConfig) {
  if (db) {
    const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
    if (doc && Array.isArray(doc.pricing) && doc.pricing.length > 0) {
      return doc.pricing.map((p) => ({ id: p.id, name: p.name, priceFen: p.priceFen, days: p.days }));
    }
  }
  return ((config && config.pricing) || []).map((p) => ({ id: p.id, name: p.name, priceFen: p.priceFen, days: p.days }));
}

async function loadUser(db, userId) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  if (!user) throw payError('user-not-found', '用户不存在，请重新登录');
  return user;
}

/**
 * 建单：金额/天数从生效档位快照，状态 pending。
 * @returns {object} 订单文档（含 _id 与 outTradeNo）
 */
async function createOrder(db, userId, planId, opts = {}) {
  const config = opts.config || AppConfig;
  const nowTs = opts.now !== undefined ? opts.now : now();
  await loadUser(db, userId);
  const plans = await resolvePricing(db, config);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw payError('plan-not-found', errors.userMessage('plan-not-found'));
  const doc = {
    userId,
    planId: plan.id,
    planName: plan.name,
    amountFen: plan.priceFen, // 快照：之后改价不影响本单，回调按此验金额
    days: plan.days,
    status: 'pending',
    channel: opts.channel || 'mock',
    outTradeNo: genOutTradeNo(nowTs),
    createdAt: nowTs,
    paidAt: null,
    baseAt: null,
    prevExpireAt: null,
    deliveredExpireAt: null,
    refundedAt: null,
    reclaimedDays: null,
  };
  const { _id } = await db.collection(COLLECTIONS.Order).insert(doc);
  return { ...doc, _id };
}

/**
 * 回调发货（服务端式）：验单 → 幂等 → 金额校验 → 续期 → 置 paid。
 * @param {{outTradeNo:string, amountFen:number, paid:boolean}} payload 归一化后的回调三要素
 * @returns {{ok:boolean, delivered?:boolean, duplicated?:boolean, reason?:string, expireAt?:number}}
 */
async function handleNotify(db, payload, opts = {}) {
  const nowTs = opts.now !== undefined ? opts.now : now();
  const col = db.collection(COLLECTIONS.Order);
  const order = await col.findOne({ outTradeNo: payload.outTradeNo });
  if (!order) return { ok: false, reason: 'order-not-found' };
  if (!payload.paid) return { ok: false, reason: 'not-paid' };
  // 幂等：重复回调直接确认成功，绝不重复发货
  if (order.status === 'paid') return { ok: true, delivered: false, duplicated: true, expireAt: order.deliveredExpireAt };
  if (order.status !== 'pending') return { ok: false, reason: 'order-not-payable' };
  // 金额以订单快照为准，不一致拒绝发货（订单保持 pending，可由正确回调再发）
  if (payload.amountFen !== order.amountFen) {
    await audit.log(db, {
      ownerId: order.userId, actorId: 'pay-notify', action: 'payment',
      targetType: 'order', targetId: order._id,
      detail: '支付回调金额与订单快照不一致，已拒绝发货',
    });
    return { ok: false, reason: 'amount-mismatch' };
  }

  // 发货：从现有到期日叠加（base = max(现在, 现有到期日)），与 admin.setMemberPlan 同口径
  const user = await loadUser(db, order.userId);
  const prevExpireAt = (user.membership && user.membership.expireAt) || null;
  const base = Math.max(nowTs, prevExpireAt || 0);
  const newExpireAt = base + order.days * DAY;
  await db.collection(COLLECTIONS.User).update(
    { _id: user._id },
    { membership: { ...(user.membership || {}), status: 'member', expireAt: newExpireAt, graceUntil: null } }
  );
  await col.update({ _id: order._id }, {
    status: 'paid', paidAt: nowTs,
    baseAt: base, prevExpireAt, deliveredExpireAt: newExpireAt,
  });
  await audit.log(db, {
    ownerId: order.userId, actorId: 'pay-notify', action: 'payment',
    targetType: 'order', targetId: order._id,
    detail: `会员订单支付成功，已发货会员 ${order.days} 天`,
  });
  return { ok: true, delivered: true, duplicated: false, expireAt: newExpireAt };
}

/** 经适配器归一化后处理回调（真实通道的发货推送从这里进） */
async function processNotify(db, adapter, rawPayload, opts = {}) {
  const normalized = adapter.handleNotify(rawPayload);
  return handleNotify(db, normalized, opts);
}

/**
 * 完整购买流程（演示/测试用编排）：建单 → 通道建单 → 调起支付 →
 * 成功走回调发货；失败/取消只改订单状态、不发货。
 * opts.duplicateNotify=true 时模拟平台把成功回调重复投递一次（验证幂等）。
 * @returns {{order:object, delivered:boolean, duplicated?:boolean, reason?:string}}
 */
async function purchase(db, userId, planId, opts = {}) {
  const adapter = opts.adapter;
  if (!adapter) throw payError('pay-no-adapter', '支付通道未配置');
  const nowTs = opts.now !== undefined ? opts.now : now();
  const order = await createOrder(db, userId, planId, { ...opts, channel: adapter.channel, now: nowTs });
  const ch = await adapter.createOrder(order);
  if (ch && ch.channelTradeNo) {
    await db.collection(COLLECTIONS.Order).update({ _id: order._id }, { channelTradeNo: ch.channelTradeNo });
    order.channelTradeNo = ch.channelTradeNo;
  }
  const result = await adapter.requestPay(order);
  if (result.status === 'success') {
    const raw = adapter.buildNotify(order, result);
    const r = await processNotify(db, adapter, raw, { now: nowTs });
    let duplicated = false;
    if (opts.duplicateNotify) {
      const r2 = await processNotify(db, adapter, raw, { now: nowTs });
      duplicated = !!r2.duplicated;
    }
    const fresh = await db.collection(COLLECTIONS.Order).findOne({ _id: order._id });
    return { order: fresh, delivered: !!r.delivered, duplicated, reason: r.reason };
  }
  const status = result.status === 'cancel' ? 'cancelled' : 'failed';
  await db.collection(COLLECTIONS.Order).update({ _id: order._id }, { status });
  await audit.log(db, {
    ownerId: userId, actorId: userId, action: 'payment',
    targetType: 'order', targetId: order._id,
    detail: status === 'cancelled' ? '会员订单支付已取消' : '会员订单支付失败',
  });
  const fresh = await db.collection(COLLECTIONS.Order).findOne({ _id: order._id });
  return { order: fresh, delivered: false, reason: status };
}

/**
 * 退款（占位）：只改状态 + 按未消耗整期回收会员时长 + 审计，不产生真实退款。
 * 回收规则见文件头。actorId 传入时须为订单本人（老板平台真实退款接入时
 * 再走管理员通道并复核）。
 * @returns {{ok:boolean, reclaimedDays?:number, expireAt?:number, reason?:string}}
 */
async function refund(db, orderId, opts = {}) {
  const nowTs = opts.now !== undefined ? opts.now : now();
  const col = db.collection(COLLECTIONS.Order);
  const order = await col.findOne({ _id: orderId });
  if (!order) return { ok: false, reason: 'order-not-found' };
  if (opts.actorId && opts.actorId !== order.userId) throw errors.permDenied('not-order-owner');
  if (order.status !== 'paid') return { ok: false, reason: 'order-not-paid' };

  // 按未消耗整期回收：只回收整天数，且不吃掉本单之前已有的时段
  const segStart = order.baseAt || nowTs;
  const segEnd = order.deliveredExpireAt || segStart;
  const unconsumedMs = segEnd - Math.max(nowTs, segStart);
  const reclaimedDays = Math.min(order.days, Math.max(0, Math.floor(unconsumedMs / DAY)));

  const user = await loadUser(db, order.userId);
  const currentExpireAt = (user.membership && user.membership.expireAt) || 0;
  const floor = order.prevExpireAt || segStart;
  const newExpireAt = Math.max(currentExpireAt - reclaimedDays * DAY, floor);
  if (reclaimedDays > 0) {
    await db.collection(COLLECTIONS.User).update(
      { _id: user._id },
      { membership: { ...(user.membership || {}), expireAt: newExpireAt } }
    );
  }
  await col.update({ _id: order._id }, { status: 'refunded', refundedAt: nowTs, reclaimedDays });
  await audit.log(db, {
    ownerId: order.userId, actorId: opts.actorId || 'system', action: 'refund',
    targetType: 'order', targetId: order._id,
    detail: `会员订单退款（占位处理，未真实退款），回收会员 ${reclaimedDays} 天`,
  });
  return { ok: true, reclaimedDays, expireAt: reclaimedDays > 0 ? newExpireAt : currentExpireAt };
}

/** 我的订单（最新在上）：只查本人，他人订单天然不可见 */
async function listOrders(db, userId) {
  return db.collection(COLLECTIONS.Order).find({ userId }, { sort: { createdAt: -1 }, limit: 100 });
}

/** 取一张订单：不存在或非本人一律拒绝 */
async function getOrderForUser(db, userId, orderId) {
  const order = await db.collection(COLLECTIONS.Order).findOne({ _id: orderId });
  if (!order) throw payError('order-not-found', errors.userMessage('order-not-found'));
  if (order.userId !== userId) throw errors.permDenied('not-order-owner');
  return order;
}

module.exports = {
  resolvePricing,
  createOrder,
  handleNotify,
  processNotify,
  purchase,
  refund,
  listOrders,
  getOrderForUser,
};
