/**
 * 任务P2 高风险测试：积分礼包购买 + 购买页视图解析。
 * 覆盖：非会员下单层拒绝且不产生订单 / 购买成功到账且重复回调不重复到账 /
 * 并发回调同单只入账一次 / 平台开关关闭时购买页状态解析（纯函数）/
 * 渲染数据来自配置（改配置后价格·赠分随变、下架档位不出现）/
 * 积分礼包退款未消耗回收 / 老板平台积分与平台开关写接口。
 * 数字均与 AppConfig 配置对照，不写死价格。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const AppConfig = require('../miniprogram/config/app-config');
const { buildPurchaseView } = require('../miniprogram/services/purchase-view');

const T0 = 1800000000000; // 2027 年，与 test-points 同基线
const DAY = 86400e3;
const mockOk = () => new core.payAdapter.MockPayAdapter({ result: 'success' });
const MEMBER = () => ({ status: 'member', expireAt: T0 + 30 * DAY, graceUntil: null });

async function memberUser(db, openid) {
  return h.newUser(db, openid, MEMBER());
}

test('积分礼包：非会员购买被拒（下单层拒绝、不产生订单），文案委婉引导开会员', async () => {
  const db = await h.newDB();
  const free = await h.newUser(db, 'free1'); // 免费用户
  const pack = AppConfig.points.packs[0];
  let err = null;
  try {
    await core.payment.purchasePointsPack(db, free, pack.id, { adapter: mockOk(), now: T0 });
  } catch (e) { err = e; }
  assert(err, '非会员购买积分礼包应抛错');
  assert.eq(err.code, 'points-pack-member-only', '错误码为 points-pack-member-only');
  assert(err.message.includes('会员'), '文案引导先开会员');
  const orders = await core.payment.listOrders(db, free);
  assert.eq(orders.length, 0, '被拒后不产生任何订单');
  assert.eq(await core.points.getBalance(db, free), 0, '被拒后积分不变');
  // 过期（缓冲期外）用户同样被拒
  const expired = await h.newUser(db, 'expired1', { status: 'member', expireAt: T0 - 40 * DAY, graceUntil: T0 - 10 * DAY });
  err = null;
  try {
    await core.payment.createPointsPackOrder(db, expired, pack.id, { now: T0 });
  } catch (e) { err = e; }
  assert(err && err.code === 'points-pack-member-only', '过期用户建单同样被拒');
  assert.eq((await core.payment.listOrders(db, expired)).length, 0, '过期用户也不产生订单');
});

test('积分礼包：会员购买成功积分到账，重复回调不重复到账，流水可对账', async () => {
  const db = await h.newDB();
  const u = await memberUser(db, 'packbuyer');
  const pack = AppConfig.points.packs[0];
  const r = await core.payment.purchasePointsPack(db, u, pack.id, { adapter: mockOk(), now: T0, duplicateNotify: true });
  assert(r.delivered, '首次回调发货成功');
  assert.eq(r.order.status, 'paid', '订单已支付');
  assert.eq(r.order.kind, 'pointsPack', '订单 kind 为积分礼包');
  assert.eq(r.order.pointsAmount, pack.points, '订单快照了礼包积分');
  assert.eq(await core.points.getBalance(db, u), pack.points, '积分到账（与配置对照），重复回调未二次入账');
  const ledger = await core.points.listLedger(db, u);
  const buys = ledger.filter((e) => e.kind === 'pack_purchase');
  assert.eq(buys.length, 1, 'pack_purchase 流水恰好一条');
  assert.eq(buys[0].delta, pack.points, '流水金额与礼包配置一致');
  assert.eq(buys[0].refId, r.order.outTradeNo, '流水关联订单号可对账');
  // 再手动重放一次回调仍然不重复到账
  const again = await core.payment.handleNotify(db, {
    outTradeNo: r.order.outTradeNo, amountFen: r.order.amountFen, paid: true,
  }, { now: T0 + 1000 });
  assert(again.duplicated, '已 paid 订单回调返回 duplicated');
  assert.eq(await core.points.getBalance(db, u), pack.points, '重放回调后余额不变');
});

test('积分礼包：并发回调同一订单只入账一次', async () => {
  const db = await h.newDB();
  const u = await memberUser(db, 'packconc');
  const pack = AppConfig.points.packs[0];
  const order = await core.payment.createPointsPackOrder(db, u, pack.id, { now: T0 });
  const notify = { outTradeNo: order.outTradeNo, amountFen: order.amountFen, paid: true };
  await Promise.all([
    core.payment.handleNotify(db, { ...notify }, { now: T0 + 1000 }),
    core.payment.handleNotify(db, { ...notify }, { now: T0 + 1000 }),
    core.payment.handleNotify(db, { ...notify }, { now: T0 + 1000 }),
  ]);
  assert.eq(await core.points.getBalance(db, u), pack.points, '三路并发回调积分只入账一次（points.grant 订单号幂等）');
  const buys = (await core.points.listLedger(db, u)).filter((e) => e.kind === 'pack_purchase');
  assert.eq(buys.length, 1, '并发下 pack_purchase 流水仍只有一条');
});

test('积分礼包：退款未消耗回收积分（只回收一次），已消耗不强扣', async () => {
  const db = await h.newDB();
  const u = await memberUser(db, 'packrefund');
  const pack = AppConfig.points.packs[0];
  const r = await core.payment.purchasePointsPack(db, u, pack.id, { adapter: mockOk(), now: T0 });
  assert.eq(await core.points.getBalance(db, u), pack.points);
  const rf = await core.payment.refund(db, r.order._id, { actorId: u, now: T0 + DAY });
  assert(rf.ok, '退款成功');
  assert.eq(rf.pointsReclaimed, pack.points, '未消耗时整额回收');
  assert.eq(await core.points.getBalance(db, u), 0, '回收后余额归零');
  const rev = (await core.points.listLedger(db, u)).filter((e) => e.kind === 'pack_purchase_reversal');
  assert.eq(rev.length, 1, '回收流水一条（pack_purchase_reversal）');

  // 已花掉一部分：不强扣、不扣成负数
  const u2 = await memberUser(db, 'packrefund2');
  const r2 = await core.payment.purchasePointsPack(db, u2, pack.id, { adapter: mockOk(), now: T0 });
  await core.points.grantRegisterBonus(db, u2); // 再补一点注册分方便花
  await core.points.spend(db, u2, await core.points.getBalance(db, u2), { kind: 'photo_import', refId: 'job_x' });
  assert.eq(await core.points.getBalance(db, u2), 0);
  const rf2 = await core.payment.refund(db, r2.order._id, { actorId: u2, now: T0 + DAY });
  assert(rf2.ok && rf2.pointsReclaimed === 0, '积分已消耗时不强扣');
  assert.eq(await core.points.getBalance(db, u2), 0, '余额不被扣成负数');
});

test('平台开关：关闭时购买页状态解析为不可买（纯函数），未配置默认开', async () => {
  const cfgOff = { payment: { platforms: { ios: { purchaseEnabled: false }, android: { purchaseEnabled: true } } } };
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(cfgOff, 'ios'), false, 'iOS 关闭');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(cfgOff, 'IOS'), false, '平台名大小写不敏感');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(cfgOff, 'android'), true, '安卓仍开着');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled({}, 'ios'), true, '无配置默认开');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(AppConfig, 'ios'), AppConfig.payment.platforms.ios.purchaseEnabled, '与静态配置对照');
  // 页面视图层：开关关 → buyEnabled=false（页面据此隐藏购买按钮）
  const view = buildPurchaseView({ plans: [], packs: [], state: 'member', purchaseEnabled: false });
  assert.eq(view.buyEnabled, false, '视图 buyEnabled 为假');
  const viewOn = buildPurchaseView({ plans: [], packs: [], state: 'member', purchaseEnabled: true });
  assert.eq(viewOn.buyEnabled, true, '开关开时 buyEnabled 为真');
});

test('购买页渲染数据来自配置：改价/改赠分随变，下架档位不出现，非会员礼包置灰', async () => {
  const db = await h.newDB();
  // 静态定版配置：年卡推荐且赠 100 分，与 AppConfig 对照
  const plans = await core.payment.resolvePricing(db);
  const year = plans.find((p) => p.id === 'year');
  assert(year && year.recommended === true, '年卡为推荐档');
  const view0 = buildPurchaseView({ plans, packs: AppConfig.points.packs, state: 'free', purchaseEnabled: true });
  assert.eq(view0.plans.length, plans.filter((p) => p.onShelf !== false).length, '上架档位全部渲染');
  assert(view0.packsLocked && view0.packs.every((p) => p.locked), '非会员视角礼包整体置灰');
  const viewM = buildPurchaseView({ plans, packs: AppConfig.points.packs, state: 'member', purchaseEnabled: true });
  assert(!viewM.packsLocked && viewM.packs.every((p) => !p.locked), '会员视角礼包可买');

  // 老板平台改配置：年卡改价+改赠分、五年卡下架、礼包改积分 → 渲染随变
  await db.collection(core.models.COLLECTIONS.AppConfig).insert({
    _id: 'singleton',
    adminIds: ['bossP2'],
    pricing: plans.map((p) => (p.id === 'year'
      ? { ...p, priceFen: 6600, grantPoints: 88 }
      : p.id === 'fiveYear' ? { ...p, onShelf: false } : p)),
    points: { packs: [{ id: 'pack9', name: '大礼包', priceFen: 900, points: 12 }] },
  });
  const plans2 = await core.payment.resolvePricing(db);
  const view2 = buildPurchaseView({ plans: plans2, packs: await core.payment.resolvePointsPacks(db), state: 'member', purchaseEnabled: true });
  const year2 = view2.plans.find((p) => p.id === 'year');
  assert.eq(year2.priceFen, 6600, '卡片价格随配置变');
  assert.eq(year2.grantPoints, 88, '卡片赠分随配置变');
  assert(!view2.plans.some((p) => p.id === 'fiveYear'), '下架档位不出现在购买页');
  assert.eq(view2.packs.length, 1, '礼包渲染新配置档位');
  assert.eq(view2.packs[0].points, 12, '礼包积分随配置变');
  // 改后的礼包真能按新价新分购买到账
  const u = await memberUser(db, 'cfgbuyer');
  const r = await core.payment.purchasePointsPack(db, u, 'pack9', { adapter: mockOk(), now: T0 });
  assert(r.delivered && r.order.amountFen === 900, '新礼包按下单快照价成交');
  assert.eq(await core.points.getBalance(db, u), 12, '新礼包积分到账');
});

test('老板平台：积分规则与平台开关写接口（管理员校验+落库生效+审计）', async () => {
  const db = await h.newDB();
  await db.collection(core.models.COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: ['bossP2'] });
  // 非管理员一律拒绝
  for (const fn of [
    () => core.admin.updatePointsSettings(db, 'intruder', { registerGrant: 1 }),
    () => core.admin.updatePaymentPlatforms(db, 'intruder', { ios: { purchaseEnabled: false } }),
  ]) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    assert(err, '非管理员调用积分/平台写接口应被拒');
  }
  // 入参校验
  let err = null;
  try { await core.admin.updatePointsSettings(db, 'bossP2', { registerGrant: -1 }); } catch (e) { err = e; }
  assert(err && err.code === 'bad-config', '负数赠送被拒');
  err = null;
  try { await core.admin.updatePaymentPlatforms(db, 'bossP2', { windows: { purchaseEnabled: true } }); } catch (e) { err = e; }
  assert(err && err.code === 'bad-config', '未知终端被拒');

  const r1 = await core.admin.updatePointsSettings(db, 'bossP2', {
    registerGrant: 20, photoImportCost: 6,
    packs: [{ id: 'packa', name: '小包', priceFen: 300, points: 3 }],
  });
  assert.eq(r1.points.registerGrant, 20, '注册赠送落库');
  const eff = await core.points.resolvePointsSettings(db);
  assert.eq(eff.photoImportCost, 6, '拍照单价生效');
  assert.eq(eff.packs[0].points, 3, '礼包档位生效（购买页/下单同源）');

  // 2026-10-30：积分包分平台价（与会员档同口径：可选、给了必须合法、购买仍走现价）
  const r1b = await core.admin.updatePointsSettings(db, 'bossP2', {
    packs: [{ id: 'packa', name: '小包', priceFen: 300, points: 3, androidPriceFen: 300, iosPriceFen: 400 }],
  });
  assert.eq(r1b.points.packs[0].androidPriceFen, 300, '礼包安卓价落库');
  assert.eq(r1b.points.packs[0].iosPriceFen, 400, '礼包苹果价落库');
  err = null;
  try {
    await core.admin.updatePointsSettings(db, 'bossP2', {
      packs: [{ id: 'packa', name: '小包', priceFen: 300, points: 3, iosPriceFen: -1 }],
    });
  } catch (e) { err = e; }
  assert(err && err.code === 'bad-config', '礼包苹果价负数被拒');

  const r2 = await core.admin.updatePaymentPlatforms(db, 'bossP2', { ios: { purchaseEnabled: false } });
  assert.eq(r2.paymentPlatforms.ios.purchaseEnabled, false, 'iOS 开关落库');
  assert.eq(r2.paymentPlatforms.android.purchaseEnabled, true, '未动的安卓保持生效值');
  const cfg = await core.admin.getConfig(db, 'bossP2');
  assert.eq(cfg.points.registerGrant, 20, 'getConfig 回读积分段');
  assert.eq(cfg.paymentPlatforms.ios.purchaseEnabled, false, 'getConfig 回读平台段');
  const trail = await core.admin.auditTrail(db, 'bossP2', {});
  assert(trail.items.some((a) => String(a.detail).includes('积分规则')), '积分修改写了审计');
  assert(trail.items.some((a) => String(a.detail).includes('平台开关')), '平台开关修改写了审计');
});
