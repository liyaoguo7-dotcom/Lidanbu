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
 * 真实通道（wxvirtual）流程不同：purchase 建单后只返回 payParams（不调起、
 * 不发货），前端调 wx.requestVirtualPayment，平台发货推送经 processNotify
 * 发货；requestPay / buildNotify 在真实适配器上故意抛错，防旧编排误调。
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
 *   赠送积分回收（2026-10-21 新口径）：按"未消耗才回收"——退款时余额
 *   ≥ 本单赠送额才整额扣回（plan_grant_reversal 流水）；不足只写审计不强扣。
 *
 * 套餐赠送积分（2026-10-21 新口径）：档位 grantPoints 在下单时快照进订单，
 * 发货成功时经 points.grant(kind=plan_grant, refId=outTradeNo) 幂等入账，
 * 与会员时长幂等并列：重复回调既不重复加时长，也不重复送分。
 *
 * 积分礼包订单（kind='pointsPack'，任务P2）：礼包在配置 points.packs，
 * 价格/积分下单时快照（pointsAmount）；仅会员可买（member/grace，
 * 非会员在下单层拒绝、不产生订单）；发货不发时长，只经
 * points.grant(kind=pack_purchase, refId=outTradeNo) 幂等入账；
 * 退款回收走 pack_purchase_reversal，规则与套餐赠分一致（未消耗才回收）。
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
const payAdapter = require('./pay-adapter');
const points = require('./points');
const quota = require('./quota');

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

/** 档位字段归一化：新字段缺省兜底（存量档位无 grantPoints/recommended/onShelf 时按 0/false/true） */
function normalizePlan(p) {
  const out = {
    id: p.id,
    name: p.name,
    priceFen: p.priceFen,
    days: p.days,
    grantPoints: Number.isInteger(p.grantPoints) ? p.grantPoints : 0,
    recommended: !!p.recommended,
    onShelf: p.onShelf !== false, // 只有显式 false 才算下架（一键下架口径）
  };
  // 分平台价（DJ 批 + 真适配器批）：整数才带出，缺省时购买走 priceFen 兜底
  if (Number.isInteger(p.androidPriceFen)) out.androidPriceFen = p.androidPriceFen;
  if (Number.isInteger(p.iosPriceFen)) out.iosPriceFen = p.iosPriceFen;
  // 档位额度（2026-10-25 会员额度按档位分）：合法才带出，core/quota 据此拦截
  const q = quota.sanitizePlanQuota(p.quota);
  if (q) out.quota = q;
  return out;
}

/**
 * 生效价格档位：老板平台配置（appConfig 文档 pricing 非空）优先，
 * 否则静态配置档位。返回干净副本（含 grantPoints/recommended/onShelf）。
 * 注意：下架档位（onShelf=false）仍在返回列表里（后台要看得到），
 * 购买页负责不显示、createOrder 负责拒绝下单。
 */
async function resolvePricing(db, config = AppConfig) {
  // 任务AD：api 分发约定 fn(db, actorId, ...args) 会把调用者 id 放进本参数位；
  // 识别到字符串（身份）时按未传配置处理，行为与本地 (db) 调用完全一致。
  if (typeof config === 'string') config = AppConfig;
  if (db) {
    const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
    if (doc && Array.isArray(doc.pricing) && doc.pricing.length > 0) {
      return doc.pricing.map(normalizePlan);
    }
  }
  return ((config && config.pricing) || []).map(normalizePlan);
}

/**
 * 某终端（平台）的购买入口是否开启：读 config.payment.platforms。
 * 页面据此 + 设备平台决定购买入口显隐，开关在配置里，改开关不动页面代码。
 * 未配置该终端时默认开启；只有显式 purchaseEnabled===false 才关闭。
 * @param {object} [config] 配置对象（缺省静态 AppConfig；老板平台覆盖由调用方合并后传入）
 * @param {string} platform 'ios' | 'android'（大小写不敏感）
 */
function resolvePlatformPurchaseEnabled(config = AppConfig, platform = '') {
  const platforms = (config && config.payment && config.payment.platforms) || {};
  const entry = platforms[String(platform || '').toLowerCase()];
  if (entry && entry.purchaseEnabled === false) return false;
  return true;
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
  // 档位不存在与已下架同口径拒绝（下架档位购买页不显示；绕过页面直接下单也拒）
  if (!plan || plan.onShelf === false) throw payError('plan-not-found', errors.userMessage('plan-not-found'));
  // 分平台价（真适配器批）：真实通道必须带合法平台，按平台价快照并锁定
  // 对应道具 ID（道具与渠道一致校验）；模拟/演示通道无平台时走现价。
  const platform = payAdapter.normalizePlatform(opts.platform);
  const isReal = !!(opts.adapter && opts.adapter.channel === 'wxvirtual');
  let amountFen = plan.priceFen;
  let productId = null;
  if (isReal) {
    if (!platform) throw payError('pay-platform-required', errors.userMessage('pay-platform-required'));
    amountFen = payAdapter.platformPriceFen(plan, platform);
    productId = payAdapter.resolveProductId(plan.id, platform);
    if (!productId) throw payError('pay-product-missing', errors.userMessage('pay-product-missing'));
  } else if (platform) {
    amountFen = payAdapter.platformPriceFen(plan, platform);
    productId = payAdapter.resolveProductId(plan.id, platform);
  }
  const doc = {
    userId,
    kind: 'plan', // 订单种类：'plan' 会员套餐 | 'pointsPack' 积分礼包（见 models 字典）
    planId: plan.id,
    planName: plan.name,
    amountFen, // 快照：之后改价不影响本单，回调按此验金额
    platform: platform || null,
    productId,
    days: plan.days,
    grantPoints: plan.grantPoints || 0, // 赠送积分快照：之后改配置不影响本单，发货时按此入账
    status: 'pending',
    channel: opts.channel || 'mock',
    mock: !!(opts.mock === true || (opts.adapter && opts.adapter.channel === 'mock')), // 模拟渠道订单标记（任务AF：管理员联调单/演示单可辨识）
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

/** 积分礼包字段归一化（配置 points.packs 的一项；分平台价同档位口径） */
function normalizePack(p) {
  const out = { id: p.id, name: p.name, priceFen: p.priceFen, points: p.points };
  if (Number.isInteger(p.androidPriceFen)) out.androidPriceFen = p.androidPriceFen;
  if (Number.isInteger(p.iosPriceFen)) out.iosPriceFen = p.iosPriceFen;
  return out;
}

/**
 * 生效积分礼包：老板平台 appConfig 文档 points 段优先，否则静态配置
 * （与 points.resolvePointsSettings 同一口径，数字全部读配置不写死）。
 */
async function resolvePointsPacks(db, config = AppConfig) {
  const settings = await points.resolvePointsSettings(db, config);
  return (settings.packs || []).map(normalizePack);
}

/**
 * 积分礼包购买门禁：仅会员可买。会员口径与"我的"页一致——
 * member（有效期内）与 grace（到期缓冲期）都算会员；free / expired 拒绝，
 * 抛 errors.pointsDenied('points-pack-member-only')，页面据此引导先开会员。
 */
async function assertMemberForPointsPack(db, userId, config = AppConfig, nowTs = now()) {
  const user = await loadUser(db, userId);
  const state = quota.getMembershipState(user, config, nowTs);
  if (state !== 'member' && state !== 'grace') {
    throw errors.pointsDenied('points-pack-member-only');
  }
  return user;
}

/**
 * 积分礼包建单：先验会员门禁（非会员在下单层直接拒绝、不产生订单），
 * 再把礼包价格/积分快照进订单（kind='pointsPack'），之后改配置不影响本单。
 * @returns {object} 订单文档（含 _id 与 outTradeNo）
 */
async function createPointsPackOrder(db, userId, packId, opts = {}) {
  const config = opts.config || AppConfig;
  const nowTs = opts.now !== undefined ? opts.now : now();
  await assertMemberForPointsPack(db, userId, config, nowTs);
  const packs = await resolvePointsPacks(db, config);
  const pack = packs.find((p) => p.id === packId);
  if (!pack) throw payError('points-pack-not-found', errors.userMessage('points-pack-not-found'));
  // 分平台价（真适配器批）：与套餐建单同口径（真实通道必须带合法平台，
  // 按平台价快照并锁定对应道具 ID；模拟通道无平台时走现价）。
  const platform = payAdapter.normalizePlatform(opts.platform);
  const isReal = !!(opts.adapter && opts.adapter.channel === 'wxvirtual');
  let amountFen = pack.priceFen;
  let productId = null;
  if (isReal) {
    if (!platform) throw payError('pay-platform-required', errors.userMessage('pay-platform-required'));
    amountFen = payAdapter.platformPriceFen(pack, platform);
    productId = payAdapter.resolveProductId(pack.id, platform);
    if (!productId) throw payError('pay-product-missing', errors.userMessage('pay-product-missing'));
  } else if (platform) {
    amountFen = payAdapter.platformPriceFen(pack, platform);
    productId = payAdapter.resolveProductId(pack.id, platform);
  }
  const doc = {
    userId,
    kind: 'pointsPack',
    planId: pack.id,
    planName: pack.name,
    amountFen, // 快照：回调按此验金额
    platform: platform || null,
    productId,
    days: 0, // 积分礼包不发会员时长
    grantPoints: 0, // 套餐赠分字段对礼包不用，积分走 pointsAmount 快照
    pointsAmount: pack.points, // 积分快照：发货时经 points.grant 幂等入账
    status: 'pending',
    channel: opts.channel || 'mock',
    mock: !!(opts.mock === true || (opts.adapter && opts.adapter.channel === 'mock')),
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
  // 幂等：重复回调直接确认成功，绝不重复发货（会员时长不重复叠加）。
  // 赠送积分在 points 侧以 outTradeNo 为 refId 幂等，这里顺手补账：
  // 万一首次发货时赠分未落账，重复回调时自动补上，仍只送一次。
  if (order.status === 'paid') {
    if (order.kind === 'pointsPack') {
      // 积分礼包：重复回调只补账不重发（points.grant 以订单号幂等）
      if (order.pointsAmount > 0) {
        await points.grant(db, order.userId, order.pointsAmount, {
          kind: 'pack_purchase', refId: order.outTradeNo, note: `购买${order.planName}`,
        });
      }
      return { ok: true, delivered: false, duplicated: true, points: order.pointsAmount || 0 };
    }
    if (order.grantPoints > 0) {
      await points.grant(db, order.userId, order.grantPoints, {
        kind: 'plan_grant', refId: order.outTradeNo, note: `购买${order.planName}赠送`,
      });
    }
    return { ok: true, delivered: false, duplicated: true, expireAt: order.deliveredExpireAt };
  }
  if (order.status !== 'pending') return { ok: false, reason: 'order-not-payable' };
  // 金额以订单快照为准，不一致拒绝发货（订单保持 pending，可由正确回调再发）。
  // 平台推送不带可信金额字段时（amountFen 为空）凭平台单号放行：金额已在
  // 下单签名时由平台验过；无平台单号又无金额的报文一律拒绝（防伪造回调）。
  if (payload.amountFen !== undefined && payload.amountFen !== null) {
    if (payload.amountFen !== order.amountFen) {
      await audit.log(db, {
        ownerId: order.userId, actorId: 'pay-notify', action: 'payment',
        targetType: 'order', targetId: order._id,
        detail: '支付回调金额与订单快照不一致，已拒绝发货',
      });
      return { ok: false, reason: 'amount-mismatch' };
    }
  } else if (!payload.platformOrderNo) {
    return { ok: false, reason: 'notify-not-authenticated' };
  }

  // 积分礼包发货：不发会员时长，只把快照积分经 points.grant 幂等入账
  // （kind='pack_purchase'、refId=订单号，与套餐赠分并列的对账口径）
  if (order.kind === 'pointsPack') {
    await col.update({ _id: order._id }, { status: 'paid', paidAt: nowTs, platformOrderNo: payload.platformOrderNo || null });
    if (order.pointsAmount > 0) {
      await points.grant(db, order.userId, order.pointsAmount, {
        kind: 'pack_purchase', refId: order.outTradeNo, note: `购买${order.planName}`,
      });
    }
    await audit.log(db, {
      ownerId: order.userId, actorId: 'pay-notify', action: 'payment',
      targetType: 'order', targetId: order._id,
      detail: `积分礼包订单支付成功，已发放 ${order.pointsAmount || 0} 积分`,
    });
    return { ok: true, delivered: true, duplicated: false, points: order.pointsAmount || 0 };
  }

  // 发货：从现有到期日叠加（base = max(现在, 现有到期日)），与 admin.setMemberPlan 同口径
  const user = await loadUser(db, order.userId);
  const prevExpireAt = (user.membership && user.membership.expireAt) || null;
  const base = Math.max(nowTs, prevExpireAt || 0);
  const newExpireAt = base + order.days * DAY;
  await db.collection(COLLECTIONS.User).update(
    { _id: user._id },
    // planId 记所持档位（2026-10-25）：额度按档位解析靠它；退款回收时只调
    // expireAt 不动 planId（membership 展开保留）
    { membership: { ...(user.membership || {}), status: 'member', expireAt: newExpireAt, graceUntil: null, planId: order.planId } }
  );
  await col.update({ _id: order._id }, {
    status: 'paid', paidAt: nowTs,
    baseAt: base, prevExpireAt, deliveredExpireAt: newExpireAt,
    platformOrderNo: payload.platformOrderNo || null,
  });
  // 套餐赠送积分入账：金额取订单快照 grantPoints，refId=outTradeNo 与时长幂等并列——
  // 同一订单的重复回调只送一次（points.grant 内部幂等，双保险）
  if (order.grantPoints > 0) {
    await points.grant(db, order.userId, order.grantPoints, {
      kind: 'plan_grant', refId: order.outTradeNo, note: `购买${order.planName}赠送`,
    });
  }
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
  if (normalized.refund) return handleRefundPush(db, normalized, opts);
  return handleNotify(db, normalized, opts);
}

/**
 * 平台退款推送（xpay_refund_notify）：只记账、不自动改状态。
 * 退款回收仍走 payment.refund 人工通道（安卓后台/接口退款、iOS 用户向
 * App Store 申请后由人工确认），避免未验签推送直接回收会员/积分；
 * 推送验签接线（云联调）后可升级为自动回收。
 */
async function handleRefundPush(db, payload, opts = {}) {
  const nowTs = opts.now !== undefined ? opts.now : now();
  const col = db.collection(COLLECTIONS.Order);
  const order = await col.findOne({ outTradeNo: payload.outTradeNo });
  if (!order) return { ok: false, reason: 'order-not-found' };
  await col.update({ _id: order._id }, { refundNotifiedAt: nowTs });
  await audit.log(db, {
    ownerId: order.userId, actorId: 'pay-notify', action: 'refund-notify',
    targetType: 'order', targetId: order._id,
    detail: '收到平台退款推送（xpay_refund_notify），已记录，回收走 payment.refund 人工通道',
  });
  return { ok: true, refundNotified: true };
}

/**
 * 云端购买总闸（任务AF 第一版发布口径）：opts.cloudGate 由 api 分发在
 * 云端调用时注入 { enabled, isAdmin }（本地演示/单测不注入、不受限）。
 * 关闸且非管理员 → 在建单之前拒绝：不产生订单、不发货、不赠分。
 * 管理员放行走模拟支付联调，其订单在建单时按 mock 渠道自动打标。
 */
function assertCloudGateOpen(opts) {
  const g = opts && opts.cloudGate;
  if (!g) return;
  if (g.enabled === true || g.isAdmin === true) return;
  throw payError('payment-closed', errors.userMessage('payment-closed'));
}

/**
 * 完整购买流程（演示/测试用编排）：建单 → 通道建单 → 调起支付 →
 * 成功走回调发货；失败/取消只改订单状态、不发货。
 * opts.duplicateNotify=true 时模拟平台把成功回调重复投递一次（验证幂等）。
 * @returns {{order:object, delivered:boolean, duplicated?:boolean, reason?:string}}
 */
async function purchase(db, userId, planId, opts = {}) {
  assertCloudGateOpen(opts);
  const adapter = opts.adapter;
  if (!adapter) throw payError('pay-no-adapter', '支付通道未配置');
  const nowTs = opts.now !== undefined ? opts.now : now();
  const order = await createOrder(db, userId, planId, { ...opts, channel: adapter.channel, now: nowTs });
  return runOrderPayment(db, order, adapter, { ...opts, now: nowTs });
}

/**
 * 购买积分礼包（编排与 purchase 同构）：建单（内含会员门禁）→ 调起 →
 * 成功回调发货积分；非会员在建单层被拒，不产生订单。
 */
async function purchasePointsPack(db, userId, packId, opts = {}) {
  assertCloudGateOpen(opts);
  const adapter = opts.adapter;
  if (!adapter) throw payError('pay-no-adapter', '支付通道未配置');
  const nowTs = opts.now !== undefined ? opts.now : now();
  const order = await createPointsPackOrder(db, userId, packId, { ...opts, channel: adapter.channel, now: nowTs });
  return runOrderPayment(db, order, adapter, { ...opts, now: nowTs });
}

/** 建单后的共用编排：通道建单 → 调起支付 → 成功走回调发货 / 失败取消只改状态 */
async function runOrderPayment(db, order, adapter, opts = {}) {
  const nowTs = opts.now !== undefined ? opts.now : now();
  const userId = order.userId;
  if (adapter.channel === 'wxvirtual') {
    // 真实通道：服务端只建单签名，不调起、不发货；前端拿 payParams 调
    // wx.requestVirtualPayment，发货只认平台发货推送（processNotify）。
    // opts 里的 platform / loginCode / sessionKey 由前端经 RPC 传入。
    const ch = await adapter.createOrder(order, opts);
    const fresh = await db.collection(COLLECTIONS.Order).findOne({ _id: order._id });
    return { order: fresh, payParams: ch.payParams, productId: ch.productId, delivered: false, pendingPay: true, reason: 'pending-pay' };
  }
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
    detail: `${order.kind === 'pointsPack' ? '积分礼包' : '会员'}订单支付${status === 'cancelled' ? '已取消' : '失败'}`,
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
  // 积分回收（口径：未消耗才回收，与套餐赠分同一规则）：余额 ≥ 本单积分额
  // 时整额扣回（套餐走 plan_grant_reversal、积分礼包走 pack_purchase_reversal，
  // 均幂等只回收一次）；余额不足——积分已被花掉一部分——只在审计里记明，
  // 不强扣、不把余额扣成负数。
  let pointsReclaimed = 0;
  let pointsNote = '';
  const reclaimAmount = order.kind === 'pointsPack' ? (order.pointsAmount || 0) : (order.grantPoints || 0);
  if (reclaimAmount > 0) {
    const balance = await points.getBalance(db, order.userId);
    if (balance >= reclaimAmount) {
      const rv = await points.reverseGrant(db, order.userId, reclaimAmount, {
        refId: order.outTradeNo,
        note: order.kind === 'pointsPack' ? '积分礼包退款回收' : '订单退款回收赠送积分',
        reversalKind: order.kind === 'pointsPack' ? 'pack_purchase_reversal' : 'plan_grant_reversal',
      });
      if (!rv.duplicated) {
        pointsReclaimed = reclaimAmount;
        pointsNote = `，回收积分 ${pointsReclaimed} 分`;
      }
    } else {
      pointsNote = `，积分已部分消耗（余额 ${balance} < 本单积分 ${reclaimAmount}），按口径不强扣`;
    }
  }
  await audit.log(db, {
    ownerId: order.userId, actorId: opts.actorId || 'system', action: 'refund',
    targetType: 'order', targetId: order._id,
    detail: order.kind === 'pointsPack'
      ? `积分礼包订单退款（占位处理，未真实退款）${pointsNote}`
      : `会员订单退款（占位处理，未真实退款），回收会员 ${reclaimedDays} 天${pointsNote}`,
  });
  return { ok: true, reclaimedDays, pointsReclaimed, expireAt: reclaimedDays > 0 ? newExpireAt : currentExpireAt };
}

/** 我的订单（最新在上）：只查本人，他人订单天然不可见 */
async function listOrders(db, userId) {
  return db.collection(COLLECTIONS.Order).find({ userId }, { sort: { createdAt: -1 }, limit: 100 });
}

/**
 * 老板平台对各终端的购买开关覆盖值（任务AD 切云新增）：读 appConfig
 * singleton 文档的 paymentPlatforms 段，未配置返回 null（调用方回退
 * 静态配置）。data-service 购买页聚合用，本地/云端共用一条路径；
 * 与 admin.getConfig 不同：本函数不要求管理员身份，只读这一个公开段。
 */
async function getPaymentPlatforms(db, actorId) {
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  return (doc && doc.paymentPlatforms) || null;
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
  resolvePlatformPurchaseEnabled,
  createOrder,
  resolvePointsPacks,
  createPointsPackOrder,
  handleNotify,
  handleRefundPush,
  processNotify,
  purchase,
  purchasePointsPack,
  refund,
  listOrders,
  getOrderForUser,
  getPaymentPlatforms,
};
