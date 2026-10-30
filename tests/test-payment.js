/**
 * 支付与会员订单（任务K，高风险：金额/订单/续期/幂等/退款）
 * 价格一律从配置读（老板平台 appConfig.pricing 优先，否则静态占位价），
 * 下单快照金额；发货只认回调且幂等；金额不符拒绝；退款按未消耗整期回收。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const fs = require('fs');
const path = require('path');
const { COLLECTIONS } = core.models;
const AppConfig = core.config;

const DAY = 86400e3;
const T0 = 1800000000000; // 固定时刻，保证用例可复现
const mockOk = () => new core.payAdapter.MockPayAdapter({ result: 'success' });

async function expireAtOf(db, userId) {
  const u = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  return u.membership && u.membership.expireAt;
}

test('支付：生效档位默认来自静态配置（月/半年/年/五年四档，用户已定价）', async () => {
  const db = await h.newDB();
  const plans = await core.payment.resolvePricing(db);
  assert.eq(plans.length, 4, '默认四档');
  assert.eq(plans.map((p) => p.id).join(','), 'month,halfYear,year,fiveYear', '档位顺序与静态配置一致');
  assert.eq(plans[0].priceFen, AppConfig.pricing[0].priceFen, '价格与静态配置一致');
  assert.eq(plans[0].grantPoints, 10, '月卡赠 10 积分');
  assert.eq(plans[1].grantPoints, 50, '半年卡赠 50 积分');
  assert.eq(plans[2].days, 365, '年卡 365 天');
  assert.eq(plans[2].grantPoints, 100, '年卡赠 100 积分');
  assert(plans[2].recommended === true, '年卡带"推荐"标记');
  assert.eq(plans[3].days, 1825, '五年卡 1825 天');
  assert.eq(plans[3].grantPoints, 500, '五年卡赠 500 积分');
  assert(plans.every((p) => p.onShelf === true), '四档默认全部上架');
});

test('支付：下单金额=配置价，改注入配置后新单金额随变', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u1');
  const o1 = await core.payment.createOrder(db, uid, 'month', { now: T0 });
  assert.eq(o1.amountFen, AppConfig.pricing[0].priceFen, '下单金额等于配置价');
  assert.eq(o1.days, AppConfig.pricing[0].days, '下单天数等于配置');
  assert.eq(o1.status, 'pending', '新单为待支付');
  const custom = { ...AppConfig, pricing: [{ id: 'month', name: '月卡', priceFen: 777, days: 31 }] };
  const o2 = await core.payment.createOrder(db, uid, 'month', { now: T0, config: custom });
  assert.eq(o2.amountFen, 777, '改配置后新单金额随变');
  assert.eq(o2.days, 31, '改配置后新单天数随变');
  assert(o1.outTradeNo !== o2.outTradeNo, '业务单号唯一');
  const o1After = await db.collection(COLLECTIONS.Order).findOne({ _id: o1._id });
  assert.eq(o1After.amountFen, AppConfig.pricing[0].priceFen, '已下单金额是快照，不随改价变化');
});

test('支付：老板平台定价（appConfig 文档）覆盖静态占位价', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u2');
  await db.collection(COLLECTIONS.AppConfig).insert({
    _id: 'singleton',
    pricing: [{ id: 'boss-plan', name: '老板档', priceFen: 555, days: 90 }],
  });
  const plans = await core.payment.resolvePricing(db);
  assert.eq(plans.length, 1, '老板平台档位生效');
  const o = await core.payment.createOrder(db, uid, 'boss-plan', { now: T0 });
  assert.eq(o.amountFen, 555, '下单金额用老板平台价');
  assert.eq(o.days, 90, '下单天数用老板平台档位');
});

test('支付：下单档位不存在被拒（plan-not-found），不产生订单', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u3');
  let err = null;
  try { await core.payment.createOrder(db, uid, 'no-such-plan', { now: T0 }); } catch (e) { err = e; }
  assert(err && err.code === 'plan-not-found', '应以 plan-not-found 拒绝');
  assert.eq(await db.collection(COLLECTIONS.Order).count({}), 0, '拒绝后未产生订单');
});

test('支付成功：未到期会员从原到期日叠加天数', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u4', { status: 'member', expireAt: T0 + 5 * DAY, graceUntil: null });
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  assert(r.delivered, '应发货');
  assert.eq(r.order.status, 'paid', '订单已支付');
  assert.eq(r.order.paidAt, T0, '支付时刻已记录');
  assert.eq(await expireAtOf(db, uid), T0 + 35 * DAY, '到期日 = 原到期 + 30 天（叠加）');
});

test('支付成功：已过期用户从今天起算', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u5', { status: 'member', expireAt: T0 - 40 * DAY, graceUntil: null });
  const before = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  assert.eq(core.quota.getMembershipState(before, AppConfig, T0), 'expired', '前提：已过缓冲期');
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  assert(r.delivered, '应发货');
  assert.eq(await expireAtOf(db, uid), T0 + 30 * DAY, '到期日 = 今天 + 30 天');
  const after = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  assert.eq(core.quota.getMembershipState(after, AppConfig, T0), 'member', '续费后回到会员状态');
});

test('支付成功：缓冲期（grace）内续费从今天起算并立即恢复会员', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u6', { status: 'member', expireAt: T0 - 5 * DAY, graceUntil: null });
  const before = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  assert.eq(core.quota.getMembershipState(before, AppConfig, T0), 'grace', '前提：在缓冲期内');
  const r = await core.payment.purchase(db, uid, 'year', { adapter: mockOk(), now: T0 });
  assert(r.delivered, '应发货');
  assert.eq(await expireAtOf(db, uid), T0 + 365 * DAY, 'grace 内续费从今天起算 + 365 天（与手工开通同一口径）');
  const after = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  assert.eq(core.quota.getMembershipState(after, AppConfig, T0), 'member', '状态立即恢复为会员');
});

test('支付：重复回调幂等，会员时长只加一次', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u7');
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0, duplicateNotify: true });
  assert(r.delivered, '首次回调应发货');
  assert(r.duplicated, '第二次回调应被识别为重复');
  assert.eq(await expireAtOf(db, uid), T0 + 30 * DAY, '重复回调后时长只加一次');
  // 再直接补一发手动重复回调
  const again = await core.payment.handleNotify(db, { outTradeNo: r.order.outTradeNo, amountFen: r.order.amountFen, paid: true }, { now: T0 });
  assert(again.ok && again.duplicated && !again.delivered, '第三次回调仍幂等');
  assert.eq(await expireAtOf(db, uid), T0 + 30 * DAY, '时长仍只加一次');
});

test('支付：回调金额与订单快照不一致，拒绝发货并写审计', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u8');
  const order = await core.payment.createOrder(db, uid, 'month', { now: T0 });
  const r = await core.payment.handleNotify(db, { outTradeNo: order.outTradeNo, amountFen: order.amountFen + 1, paid: true }, { now: T0 });
  assert(!r.ok && r.reason === 'amount-mismatch', '金额不符应拒绝');
  const fresh = await db.collection(COLLECTIONS.Order).findOne({ _id: order._id });
  assert.eq(fresh.status, 'pending', '拒绝后订单仍为待支付');
  assert.eq(await expireAtOf(db, uid), null, '未发货：会员未开通');
  const logs = await db.collection(COLLECTIONS.AuditLog).find({ ownerId: uid, action: 'payment' });
  assert(logs.some((l) => l.detail.includes('不一致')), '拒绝发货已写审计');
  // 正确金额的回调随后到达，仍可正常发货
  const r2 = await core.payment.handleNotify(db, { outTradeNo: order.outTradeNo, amountFen: order.amountFen, paid: true }, { now: T0 });
  assert(r2.ok && r2.delivered, '正确回调应发货');
});

test('支付失败：订单置 failed，不发货', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u9');
  const r = await core.payment.purchase(db, uid, 'month', {
    adapter: new core.payAdapter.MockPayAdapter({ result: 'fail' }), now: T0,
  });
  assert(!r.delivered, '失败不应发货');
  assert.eq(r.order.status, 'failed', '订单状态为 failed');
  assert.eq(await expireAtOf(db, uid), null, '会员未开通');
});

test('支付取消：订单置 cancelled，不发货', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u10');
  const r = await core.payment.purchase(db, uid, 'month', {
    adapter: new core.payAdapter.MockPayAdapter({ result: 'cancel' }), now: T0,
  });
  assert(!r.delivered, '取消不应发货');
  assert.eq(r.order.status, 'cancelled', '订单状态为 cancelled');
  assert.eq(await expireAtOf(db, uid), null, '会员未开通');
});

test('退款：本单时段尚未开始（整期未消耗），整期回收', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u11', { status: 'member', expireAt: T0 + 10 * DAY, graceUntil: null });
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  assert.eq(await expireAtOf(db, uid), T0 + 40 * DAY, '前提：已叠加到 +40 天');
  const rf = await core.payment.refund(db, r.order._id, { actorId: uid, now: T0 });
  assert(rf.ok, '退款应成功（占位处理）');
  assert.eq(rf.reclaimedDays, 30, '整期 30 天全部回收');
  assert.eq(await expireAtOf(db, uid), T0 + 10 * DAY, '到期日回到发货前');
  const fresh = await db.collection(COLLECTIONS.Order).findOne({ _id: r.order._id });
  assert.eq(fresh.status, 'refunded', '订单置 refunded');
  assert.eq(fresh.reclaimedDays, 30, '回收天数落单');
});

test('退款：本单时段已部分消耗，按未消耗整天回收（零头不回收）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u12');
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  assert.eq(await expireAtOf(db, uid), T0 + 30 * DAY, '前提：到期 +30 天');
  // 10.5 天后退款：未消耗 19.5 天 → 只回收 19 个整天
  const rf = await core.payment.refund(db, r.order._id, { actorId: uid, now: T0 + 10.5 * DAY });
  assert(rf.ok, '退款应成功');
  assert.eq(rf.reclaimedDays, 19, '只回收未消耗的整天数');
  assert.eq(await expireAtOf(db, uid), T0 + 11 * DAY, '到期日 = +30 − 19 天');
  // 重复退款被拒
  const rf2 = await core.payment.refund(db, r.order._id, { actorId: uid, now: T0 + 11 * DAY });
  assert(!rf2.ok && rf2.reason === 'order-not-paid', '已退款订单不可重复退款');
});

test('订单可见性：他人订单不可见、不可取、不可退款', async () => {
  const db = await h.newDB();
  const a = await h.newUser(db, 'pay_ua');
  const b = await h.newUser(db, 'pay_ub');
  const r = await core.payment.purchase(db, a, 'month', { adapter: mockOk(), now: T0 });
  const listB = await core.payment.listOrders(db, b);
  assert.eq(listB.length, 0, '他人订单列表为空');
  const listA = await core.payment.listOrders(db, a);
  assert.eq(listA.length, 1, '本人能看到自己的订单');
  let err = null;
  try { await core.payment.getOrderForUser(db, b, r.order._id); } catch (e) { err = e; }
  assert(err && err.code === 'not-order-owner', '越权取单被拒');
  err = null;
  try { await core.payment.refund(db, r.order._id, { actorId: b, now: T0 }); } catch (e) { err = e; }
  assert(err && err.code === 'not-order-owner', '越权退款被拒');
  err = null;
  try { await core.payment.getOrderForUser(db, a, 'no-such-id'); } catch (e) { err = e; }
  assert(err && err.code === 'order-not-found', '不存在的订单如实报错');
});

test('支付适配层：微信虚拟支付已接通（建单签名、调起与退款走前端/后台通道）', async () => {
  const wx = new core.payAdapter.WechatVirtualPayAdapter({ appKey: 'k', appSecret: 's', env: {} });
  assert.eq(wx.channel, 'wxvirtual', '通道名');
  const r = await wx.createOrder({ outTradeNo: 'LD1', amountFen: 1000, planId: 'month', kind: 'plan' }, { platform: 'android', sessionKey: 'sk' });
  assert(r.payParams && r.payParams.paySig, '建单应返回签名');
  assert.eq(r.productId, 'month_android', '安卓道具');
  for (const m of ['requestPay', 'refund']) {
    let err = null;
    try { await wx[m]({ outTradeNo: 'X', amountFen: 1 }); } catch (e) { err = e; }
    assert(err && err.code === 'pay-not-implemented', `${m} 应为未接服务端口径（调起走前端、退款走后台/应用商店）`);
  }
  const n = wx.handleNotify({ Event: 'xpay_goods_deliver_notify', OutTradeNo: 'LD1', WeChatPayInfo: { MchOrderNo: 'wx-9' } });
  assert(n.paid && n.outTradeNo === 'LD1' && n.platformOrderNo === 'wx-9', '发货推送报文归一化形状正确');
});

test('支付：赠送积分随订单快照入账，改配置后已下单仍按快照送分', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pay_u14');
  const order = await core.payment.createOrder(db, uid, 'month', { now: T0 });
  assert.eq(order.grantPoints, AppConfig.pricing[0].grantPoints, '下单时赠分已快照');
  // 下单后老板平台把赠分改成大数字，已下单不应跟着变
  await db.collection(COLLECTIONS.AppConfig).insert({
    _id: 'singleton',
    pricing: [{ id: 'month', name: '月卡', priceFen: order.amountFen, days: 30, grantPoints: 999, recommended: false, onShelf: true }],
  });
  const r = await core.payment.handleNotify(db, { outTradeNo: order.outTradeNo, amountFen: order.amountFen, paid: true }, { now: T0 });
  assert(r.ok && r.delivered, '回调应发货');
  assert.eq(await core.points.getBalance(db, uid), order.grantPoints, '入账的是快照赠分，不是改后的配置');
});

test('支付提醒衔接：发货更新到期日后，任务L提醒判定按新周期走', async () => {
  const db = await h.newDB();
  // 到期前 10 天：第一次检查应发出"到期前 15 天"提醒（其触发点已过）
  const uid = await h.newUser(db, 'pay_u13', { status: 'member', expireAt: T0 + 10 * DAY, graceUntil: null });
  const f1 = await core.notify.checkMembershipReminders(db, uid, T0);
  assert(f1.fired.includes('membershipExpiring'), '临近到期应发出到期前提醒');
  // 续费 30 天后，新到期日在 40 天后：同一时刻再检查，不应误发新提醒
  await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  const f2 = await core.notify.checkMembershipReminders(db, uid, T0);
  assert.eq(f2.fired.length, 0, '续费后按新到期日判定，不误发');
  // 到新周期的到期前 15 天触发点（+25 天）再检查，应按新到期日发出一次
  const f3 = await core.notify.checkMembershipReminders(db, uid, T0 + 25 * DAY);
  assert(f3.fired.includes('membershipExpiring'), '新周期到点应发提醒');
  const f4 = await core.notify.checkMembershipReminders(db, uid, T0 + 26 * DAY);
  assert(!f4.fired.includes('membershipExpiring'), '同一提醒不重复发（dedupeKey）');
});

test('支付：会员页面源码无写死价格（扫描）+ 配置字段断言', async () => {
  const files = [
    'miniprogram/pages/member/member-home.js',
    'miniprogram/pages/member/member-home.wxml',
    'miniprogram/pages/member/purchase/purchase.js',
    'miniprogram/pages/member/purchase/purchase.wxml',
    'miniprogram/pages/member/orders/orders.js',
    'miniprogram/pages/member/orders/orders.wxml',
  ];
  const bad = /(priceFen\s*[:=]\s*\d|price\s*[:=]\s*['"]?\d|[¥￥]\s*\d|\d+\s*元)/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert(!bad.test(src), `${f} 不得出现写死价格字面量`);
  }
  const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/config/app-config.js'), 'utf8');
  assert(cfgSrc.includes('grantPoints') && cfgSrc.includes('onShelf'), '静态配置档位须带赠送积分与上架开关字段');
  assert.eq(AppConfig.pricing.length, 4, '静态档位四档（月/半年/年/十年）');
  assert(AppConfig.points.registerGrant > 0 && AppConfig.points.photoImportCost > 0, '积分规则数字在配置里');
  assert(AppConfig.safetyCaps.perBook >= 5000, '安全上限在配置里（每本 5000 笔）');
});
