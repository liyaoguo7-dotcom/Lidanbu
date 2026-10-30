/**
 * 真适配器批（2026-10-30）：微信虚拟支付真实通道
 * - 签名：signData 字段、paySig/signature 算法与格式、确定性
 * - 道具表：14 个道具 ID 全覆盖、未知档位/平台取不到
 * - 分平台价：ios/android/缺省兜底
 * - 建单：真实通道必须带合法平台、无平台拒单、无道具拒单、缺 AppKey 拒单
 * - 购买编排：真实通道只返回 payParams（不发货），订单保持 pending
 * - 发货推送：发货、幂等、金额不符拒绝、无金额无单号拒绝、退款推送只记账
 * - code2Session：注入假 http 换 session_key；缺 AppSecret 拒单
 * - 档位与礼包：五年卡数据、分平台价、退款规则文案、购买页调起与确认
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const fs = require('fs');
const path = require('path');
const { COLLECTIONS } = core.models;
const AppConfig = core.config;

const T0 = 1800000000000;
const SK = 'test-session-key-123';
const APPKEY = 'test-app-key-abc';

function realAdapter(over = {}) {
  return new core.payAdapter.WechatVirtualPayAdapter({
    appKey: APPKEY, appSecret: 'test-secret', env: {}, ...over,
  });
}

test('真适配器：签名三件套字段与格式、确定性', async () => {
  const signData = core.payAdapter.buildSignData({ productId: 'month_android', amountFen: 1000, outTradeNo: 'LDTEST001', attach: 'plan:month' });
  assert.eq(signData.offerId, '14507000890', 'offerId');
  assert.eq(signData.buyQuantity, 1, 'buyQuantity');
  assert.eq(signData.env, 0, 'env 正式');
  assert.eq(signData.currencyType, 'CNY', '币种');
  assert.eq(signData.productId, 'month_android', '道具');
  assert.eq(signData.goodsPrice, 1000, '金额（分）');
  assert.eq(signData.outTradeNo, 'LDTEST001', '单号');
  const p1 = core.payAdapter.signPayParams({ appKey: APPKEY, sessionKey: SK, signData });
  const p2 = core.payAdapter.signPayParams({ appKey: APPKEY, sessionKey: SK, signData });
  assert.eq(p1.paySig, p2.paySig, 'paySig 确定性');
  assert.eq(p1.signature, p2.signature, 'signature 确定性');
  assert(/^[0-9a-f]{64}$/.test(p1.paySig), 'paySig 为 64 位 hex');
  assert(/^[0-9a-f]{64}$/.test(p1.signature), 'signature 为 64 位 hex');
  assert.eq(p1.mode, 'short_series_goods', 'mode 短剧商品');
  const p3 = core.payAdapter.signPayParams({ appKey: APPKEY, sessionKey: 'other-sk', signData });
  assert(p3.signature !== p1.signature, '换 sessionKey 则 signature 变');
  const p4 = core.payAdapter.signPayParams({ appKey: 'other-key', sessionKey: SK, signData });
  assert(p4.paySig !== p1.paySig, '换 AppKey 则 paySig 变');
  const parsed = JSON.parse(p1.signData);
  assert.eq(parsed.productId, 'month_android', 'signData 为 JSON 字符串');
});

test('真适配器：14 个道具 ID 全覆盖，未知档位/平台取不到', async () => {
  const expect = {
    month: ['month_android', 'month_ios'],
    halfYear: ['halfYear_android', 'halfYear_ios'],
    year: ['year_android', 'year_ios'],
    fiveYear: ['fiveYear_android', 'fiveYear_ios'],
    points10: ['points10_android', 'points10_ios'],
    points30: ['points30_android', 'points30_ios'],
    points50: ['points50_android', 'points50_ios'],
  };
  for (const [id, [a, i]] of Object.entries(expect)) {
    assert.eq(core.payAdapter.resolveProductId(id, 'android'), a, `${id} 安卓道具`);
    assert.eq(core.payAdapter.resolveProductId(id, 'ios'), i, `${id} 苹果道具`);
  }
  assert.eq(core.payAdapter.resolveProductId('nope', 'android'), null, '未知档位取不到');
  assert.eq(core.payAdapter.resolveProductId('month', 'windows'), null, '未知平台取不到');
  assert.eq(core.payAdapter.resolveProductId('month', ''), null, '无平台取不到');
});

test('真适配器：分平台价（对应平台价优先，缺省跟现价）', async () => {
  const plan = { priceFen: 7000, androidPriceFen: 7000, iosPriceFen: 7900 };
  assert.eq(core.payAdapter.platformPriceFen(plan, 'ios'), 7900, '苹果价');
  assert.eq(core.payAdapter.platformPriceFen(plan, 'android'), 7000, '安卓价');
  assert.eq(core.payAdapter.platformPriceFen({ priceFen: 555 }, 'ios'), 555, '缺省跟现价');
});

test('真适配器：建单必须带合法平台与已配道具，缺 AppKey 拒单', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'payreal_u1');
  const adapter = realAdapter();
  let err = null;
  try { await core.payment.createOrder(db, uid, 'month', { now: T0, adapter }); } catch (e) { err = e; }
  assert(err && err.code === 'pay-platform-required', '无平台应以 pay-platform-required 拒绝');
  const custom = { ...AppConfig, pricing: [{ id: 'boss-plan', name: '老板档', priceFen: 555, days: 90 }] };
  err = null;
  try { await core.payment.createOrder(db, uid, 'boss-plan', { now: T0, config: custom, adapter, platform: 'ios' }); } catch (e) { err = e; }
  assert(err && err.code === 'pay-product-missing', '未配道具应以 pay-product-missing 拒绝');
  const noKey = new core.payAdapter.WechatVirtualPayAdapter({ env: {} });
  err = null;
  try { await core.payment.purchase(db, uid, 'month', { now: T0, adapter: noKey, platform: 'android', sessionKey: SK }); } catch (e) { err = e; }
  assert(err && err.code === 'pay-appkey-missing', '缺 AppKey 应以 pay-appkey-missing 拒绝');
});

test('真适配器：购买只返回 payParams（不发货），订单保持 pending', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'payreal_u2');
  const adapter = realAdapter();
  const r = await core.payment.purchase(db, uid, 'year', { now: T0, adapter, platform: 'ios', sessionKey: SK });
  assert(r.pendingPay === true, '应返回待支付');
  assert(r.delivered === false, '不应直接发货');
  assert(r.payParams && r.payParams.paySig, '应返回签名');
  assert.eq(r.productId, 'year_ios', '苹果平台对 year_ios 道具');
  assert.eq(r.order.status, 'pending', '订单保持待支付');
  assert.eq(r.order.amountFen, 7900, '苹果价快照 7900 分');
  assert.eq(r.order.productId, 'year_ios', '订单快照道具 ID');
  let err = null;
  try { await adapter.requestPay(r.order); } catch (e) { err = e; }
  assert(err && err.code === 'pay-not-implemented', 'requestPay 应抛错（防旧编排误调）');
});

test('真适配器：发货推送发货、重复推送幂等、金额不符拒绝、无单号无金额拒绝', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'payreal_u3');
  const adapter = realAdapter();
  const r = await core.payment.purchase(db, uid, 'month', { now: T0, adapter, platform: 'android', sessionKey: SK });
  const push = { Event: 'xpay_goods_deliver_notify', OutTradeNo: r.order.outTradeNo, WeChatPayInfo: { MchOrderNo: 'wx-1001' } };
  const d1 = await core.payment.processNotify(db, adapter, push, { now: T0 });
  assert(d1.delivered === true, '发货推送应发货');
  const d2 = await core.payment.processNotify(db, adapter, push, { now: T0 });
  assert(d2.duplicated === true, '重复推送应幂等');
  const stored = await db.collection(COLLECTIONS.Order).findOne({ _id: r.order._id });
  assert.eq(stored.platformOrderNo, 'wx-1001', '平台单号应存订单');
  assert.eq(stored.status, 'paid', '订单已支付');
  const r2 = await core.payment.purchase(db, uid, 'month', { now: T0, adapter, platform: 'android', sessionKey: SK });
  const bad = await core.payment.processNotify(db, adapter, { Event: 'xpay_goods_deliver_notify', OutTradeNo: r2.order.outTradeNo, amountFen: 999999, WeChatPayInfo: { MchOrderNo: 'wx-1002' } }, { now: T0 });
  assert(bad.ok === false && bad.reason === 'amount-mismatch', '金额不符应拒绝');
  const r3 = await core.payment.purchase(db, uid, 'month', { now: T0, adapter, platform: 'android', sessionKey: SK });
  const unauth = await core.payment.processNotify(db, adapter, { Event: 'xpay_goods_deliver_notify', OutTradeNo: r3.order.outTradeNo }, { now: T0 });
  assert(unauth.ok === false && unauth.reason === 'notify-not-authenticated', '无单号无金额应拒绝');
});

test('真适配器：退款推送只记账、不改订单状态', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'payreal_u4');
  const adapter = realAdapter();
  const r = await core.payment.purchase(db, uid, 'month', { now: T0, adapter, platform: 'android', sessionKey: SK });
  await core.payment.processNotify(db, adapter, { Event: 'xpay_goods_deliver_notify', OutTradeNo: r.order.outTradeNo, WeChatPayInfo: { MchOrderNo: 'wx-1003' } }, { now: T0 });
  const rf = await core.payment.processNotify(db, adapter, { Event: 'xpay_refund_notify', OutTradeNo: r.order.outTradeNo, WeChatPayInfo: { MchOrderNo: 'wx-1003' } }, { now: T0 });
  assert(rf.ok === true && rf.refundNotified === true, '退款推送应记账成功');
  const stored = await db.collection(COLLECTIONS.Order).findOne({ _id: r.order._id });
  assert.eq(stored.status, 'paid', '退款推送不应自动改订单状态');
  assert(stored.refundNotifiedAt, '应记退款推送时间');
});

test('真适配器：loginCode 经 code2Session 换 session_key 签名；缺 AppSecret 拒单', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'payreal_u5');
  let seenUrl = '';
  const adapter = new core.payAdapter.WechatVirtualPayAdapter({
    appKey: APPKEY, appSecret: 'test-secret', env: {},
    httpGetJson: async (url) => { seenUrl = url; return { session_key: 'sk-from-code' }; },
  });
  const r = await core.payment.purchase(db, uid, 'month', { now: T0, adapter, platform: 'android', loginCode: 'test-code-123' });
  assert(r.pendingPay === true, '应建单成功');
  assert(seenUrl.includes('jscode2session'), '应调 code2Session');
  assert(seenUrl.includes('test-code-123'), '应带上 loginCode');
  const noSecret = new core.payAdapter.WechatVirtualPayAdapter({ appKey: APPKEY, env: {}, httpGetJson: async () => ({}) });
  let err = null;
  try { await core.payment.purchase(db, uid, 'month', { now: T0, adapter: noSecret, platform: 'android', loginCode: 'x' }); } catch (e) { err = e; }
  assert(err && err.code === 'pay-appsecret-missing', '缺 AppSecret 应拒单');
});

test('真适配器：积分包购买按平台价快照、返回待支付', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'payreal_u6', { status: 'member', expireAt: T0 + 30 * 86400e3, graceUntil: null });
  const adapter = realAdapter();
  const r = await core.payment.purchasePointsPack(db, uid, 'points30', { now: T0, adapter, platform: 'ios', sessionKey: SK });
  assert(r.pendingPay === true, '应返回待支付');
  assert.eq(r.productId, 'points30_ios', '苹果平台对 points30_ios 道具');
  assert.eq(r.order.amountFen, 500, '30 分包苹果价快照 500 分');
  assert.eq(r.order.pointsAmount, 30, '积分快照 30 分');
});

test('真适配器：五年卡与积分包数据、分平台价、退款规则文案、购买页调起', async () => {
  const db = await h.newDB();
  const plans = await core.payment.resolvePricing(db);
  const five = plans.find((p) => p.id === 'fiveYear');
  assert(five, '应有五年卡');
  assert.eq(five.days, 1825, '五年卡 1825 天');
  assert.eq(five.grantPoints, 500, '五年卡赠 500 分');
  assert.eq(five.androidPriceFen, 19800, '五年卡安卓价');
  assert.eq(five.iosPriceFen, 22500, '五年卡苹果价');
  assert.eq(five.quota.receiveEvents, 50, '五年卡礼薄 50');
  assert(!plans.some((p) => p.id === 'decade'), '十年卡应已清掉');
  const packs = await core.payment.resolvePointsPacks(db);
  assert.eq(packs.map((p) => p.id).join(','), 'points10,points30,points50', '礼包三档');
  assert.eq(packs[0].points, 10, '10 分包');
  assert.eq(packs[0].androidPriceFen, 100, '10 分包安卓价');
  assert.eq(packs[0].iosPriceFen, 200, '10 分包苹果价');
  assert.eq(packs[2].iosPriceFen, 800, '50 分包苹果价');
  const notice = AppConfig.payment.refundNotice || '';
  // 2026-10-31 DR批（用户定）：购买页展示文案改为“虚拟产品一经购买不能退款”，
  // 旧“安卓可申请退款/App Store/180天/剩余天数”展示口径作废；服务端退款记账
  // 口径不变（见 core/payment 退款测试），此处只断言展示文案。
  assert.eq(notice, '本产品为虚拟产品，一经购买不能退款，购买前请确定。', '退款展示文案应为 DR 新口径');
  const purchaseJs = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/member/purchase/purchase.js'), 'utf8');
  assert(purchaseJs.includes('wx.requestVirtualPayment'), '购买页应调 wx.requestVirtualPayment');
  assert(purchaseJs.includes('confirmRefundNotice'), '购买页应有付款前退款规则确认');
  const purchaseWxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/member/purchase/purchase.wxml'), 'utf8');
  assert(purchaseWxml.includes('refundNotice'), '购买页模板应展示退款规则');
  assert(!purchaseWxml.includes('模拟支付成功'), '购买页不得再宣称模拟支付（真实通道已接通）');
  const remote = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/services/remote-core.js'), 'utf8');
  assert(remote.includes('getOrderForUser'), '远程 core 应开放 getOrderForUser（轮询发货状态用）');
});
