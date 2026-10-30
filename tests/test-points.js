/**
 * 积分账户（任务P1，高风险：赠送幂等/扣费原子性/失败返还/到期保留）
 * 数字全部读配置：注册赠送、套餐赠分、拍照消耗均以 AppConfig 为准，
 * 用例断言一律与配置对照，不写死业务数字（个别口径数字与配置同源断言）。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const AppConfig = core.config;

const DAY = 86400e3;
const T0 = 1800000000000;
const mockOk = () => new core.payAdapter.MockPayAdapter({ result: 'success' });

async function ledgerOf(db, uid, kind) {
  const all = await core.points.listLedger(db, uid, { limit: 1000 });
  return kind ? all.filter((e) => e.kind === kind) : all;
}

test('积分：注册赠送只发一次（重复初始化不重复送）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_reg');
  const want = AppConfig.points.registerGrant;
  assert(want > 0, '前提：配置的注册赠送为正数');
  const r1 = await core.points.grantRegisterBonus(db, uid);
  assert(!r1.duplicated, '首次应实际发放');
  assert.eq(r1.balance, want, '余额=配置的注册赠送数');
  const r2 = await core.points.grantRegisterBonus(db, uid);
  assert(r2.duplicated, '第二次初始化应识别为重复');
  const r3 = await core.points.grantRegisterBonus(db, uid);
  assert(r3.duplicated, '第三次仍重复');
  assert.eq(await core.points.getBalance(db, uid), want, '重复初始化后余额不翻倍');
  const entries = await ledgerOf(db, uid, 'register_grant');
  assert.eq(entries.length, 1, '注册赠送流水只有一条');
  assert.eq(entries[0].refId, `register:${uid}`, 'refId 为固定注册键');
  assert.eq(entries[0].delta, want, '流水金额=赠送数');
});

test('积分：套餐赠送只发一次（重复支付回调不重复送分）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_plan');
  const month = AppConfig.pricing.find((p) => p.id === 'month');
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0, duplicateNotify: true });
  assert(r.delivered, '首次回调应发货');
  assert(r.duplicated, '第二次回调应被识别为重复');
  assert.eq(await core.points.getBalance(db, uid), month.grantPoints, '余额=月卡赠送积分，只送一次');
  const entries = await ledgerOf(db, uid, 'plan_grant');
  assert.eq(entries.length, 1, '套餐赠送流水只有一条');
  assert.eq(entries[0].refId, r.order.outTradeNo, '赠送流水 refId=订单号，可对账');
  // 再手动补发一次重复回调，仍不重复送
  const again = await core.payment.handleNotify(db, { outTradeNo: r.order.outTradeNo, amountFen: r.order.amountFen, paid: true }, { now: T0 });
  assert(again.duplicated, '第三次回调仍幂等');
  assert.eq(await core.points.getBalance(db, uid), month.grantPoints, '余额仍只送一次');
});

test('积分：扣费原子性与幂等（同一次拍照任务只扣一次）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_spend');
  await core.points.grant(db, uid, 20, { kind: 'manual', refId: 'seed-1' });
  const cost = AppConfig.points.photoImportCost;
  const s1 = await core.points.spend(db, uid, cost, { kind: 'photo_import', refId: 'job-1' });
  assert(!s1.duplicated, '首次扣费应实际扣');
  assert.eq(s1.balance, 20 - cost, '扣后余额正确');
  // 重复点击/网络重试：同 jobId 再扣两次
  const s2 = await core.points.spend(db, uid, cost, { kind: 'photo_import', refId: 'job-1' });
  const s3 = await core.points.spend(db, uid, cost, { kind: 'photo_import', refId: 'job-1' });
  assert(s2.duplicated && s3.duplicated, '同 refId 重复扣费应识别为重复');
  assert.eq(await core.points.getBalance(db, uid), 20 - cost, '重复扣费不多扣');
  assert.eq((await ledgerOf(db, uid, 'photo_import')).length, 1, '消耗流水只有一条');
  // 不同任务正常扣第二次
  const s4 = await core.points.spend(db, uid, cost, { kind: 'photo_import', refId: 'job-2' });
  assert(!s4.duplicated, '新任务应正常扣费');
  assert.eq(s4.balance, 20 - cost * 2, '两次任务共扣两次');
});

test('积分：余额不足拒绝（insufficient-points），余额与流水不变', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_poor');
  await core.points.grant(db, uid, 3, { kind: 'manual', refId: 'seed-1' });
  const before = (await ledgerOf(db, uid)).length;
  let err = null;
  try {
    await core.points.spend(db, uid, AppConfig.points.photoImportCost, { kind: 'photo_import', refId: 'job-x' });
  } catch (e) { err = e; }
  assert(err && err.code === 'insufficient-points', '应以 insufficient-points 拒绝，实际 ' + (err && err.code));
  assert(/积分不够啦/.test(err.message), '文案须委婉可读');
  assert.eq(await core.points.getBalance(db, uid), 3, '拒绝后余额不变');
  assert.eq((await ledgerOf(db, uid)).length, before, '拒绝后不产生流水');
});

test('积分：失败返还（只退一次、超额退被拒、退不存在的被拒）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_refund');
  await core.points.grant(db, uid, 20, { kind: 'manual', refId: 'seed-1' });
  const cost = AppConfig.points.photoImportCost;
  await core.points.spend(db, uid, cost, { kind: 'photo_import', refId: 'job-fail' });
  assert.eq(await core.points.getBalance(db, uid), 20 - cost, '前提：已扣费');
  const f1 = await core.points.refund(db, uid, cost, { refId: 'job-fail' });
  assert(!f1.duplicated, '首次返还应实际退');
  assert.eq(f1.balance, 20, '返还后余额恢复');
  assert.eq(f1.entry.kind, 'photo_refund', '冲正流水 kind=photo_refund');
  assert.eq(f1.entry.refId, 'job-fail:refund', '冲正键=原 refId+:refund');
  const f2 = await core.points.refund(db, uid, cost, { refId: 'job-fail' });
  assert(f2.duplicated, '重复返还应识别为重复');
  assert.eq(await core.points.getBalance(db, uid), 20, '重复返还不多退');
  // 超额退：原扣 cost，退 cost+1 被拒
  await core.points.spend(db, uid, cost, { kind: 'photo_import', refId: 'job-fail2' });
  let err = null;
  try { await core.points.refund(db, uid, cost + 1, { refId: 'job-fail2' }); } catch (e) { err = e; }
  assert(err && err.code === 'points-refund-exceeds', '超额退应以 points-refund-exceeds 拒绝');
  assert.eq(await core.points.getBalance(db, uid), 20 - cost, '超额退被拒后余额不变');
  // 退一笔不存在的消费
  err = null;
  try { await core.points.refund(db, uid, 1, { refId: 'no-such-job' }); } catch (e) { err = e; }
  assert(err && err.code === 'points-refund-not-found', '无原扣应以 points-refund-not-found 拒绝');
});

test('积分：到期后积分保留，续费后继续可用', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_keep', { status: 'member', expireAt: T0 + 10 * DAY, graceUntil: null });
  const year = AppConfig.pricing.find((p) => p.id === 'year');
  await core.payment.purchase(db, uid, 'year', { adapter: mockOk(), now: T0 });
  assert.eq(await core.points.getBalance(db, uid), year.grantPoints, '前提：年卡赠分已到账');
  // 模拟会员彻底过期（超过缓冲期）
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  await db.collection(COLLECTIONS.User).update({ _id: uid }, {
    membership: { ...user.membership, expireAt: T0 - 40 * DAY },
  });
  const expired = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  assert.eq(core.quota.getMembershipState(expired, AppConfig, T0), 'expired', '前提：已过缓冲期');
  assert.eq(await core.points.getBalance(db, uid), year.grantPoints, '会员过期后积分一分不少');
  assert((await ledgerOf(db, uid)).length >= 1, '过期后流水仍在');
  // 续费后继续可用：先续费再花积分
  await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  const bal = await core.points.getBalance(db, uid);
  const s = await core.points.spend(db, uid, AppConfig.points.photoImportCost, { kind: 'photo_import', refId: 'job-after-renew' });
  assert(!s.duplicated && s.balance === bal - AppConfig.points.photoImportCost, '续费后积分可继续消耗');
});

test('积分：退款回收赠送积分（未消耗，整额回收且只回收一次）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_reclaim');
  const year = AppConfig.pricing.find((p) => p.id === 'year');
  const r = await core.payment.purchase(db, uid, 'year', { adapter: mockOk(), now: T0 });
  assert.eq(await core.points.getBalance(db, uid), year.grantPoints, '前提：赠分已到账');
  const rf = await core.payment.refund(db, r.order._id, { actorId: uid, now: T0 });
  assert(rf.ok, '退款应成功');
  assert.eq(rf.pointsReclaimed, year.grantPoints, '未消耗的赠分整额回收');
  assert.eq(await core.points.getBalance(db, uid), 0, '回收后余额归零');
  const rev = await ledgerOf(db, uid, 'plan_grant_reversal');
  assert.eq(rev.length, 1, '回收流水只有一条');
  assert.eq(rev[0].delta, -year.grantPoints, '回收流水为负数整额');
});

test('积分：退款时赠分已部分消耗，只写审计不强扣', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_partial');
  const year = AppConfig.pricing.find((p) => p.id === 'year');
  const r = await core.payment.purchase(db, uid, 'year', { adapter: mockOk(), now: T0 });
  // 先花掉一大半赠分，余额 < 赠送额
  await core.points.spend(db, uid, year.grantPoints - 10, { kind: 'photo_import', refId: 'job-big' });
  const balBefore = await core.points.getBalance(db, uid);
  assert(balBefore < year.grantPoints, '前提：余额已不足整额回收');
  const rf = await core.payment.refund(db, r.order._id, { actorId: uid, now: T0 });
  assert(rf.ok, '退款本身应成功');
  assert.eq(rf.pointsReclaimed, 0, '余额不足时不回收积分');
  assert.eq(await core.points.getBalance(db, uid), balBefore, '不强扣：余额一分不动');
  assert.eq((await ledgerOf(db, uid, 'plan_grant_reversal')).length, 0, '不产生回收流水');
  const logs = await db.collection(COLLECTIONS.AuditLog).find({ ownerId: uid, action: 'refund' });
  assert(logs.some((l) => l.detail.includes('不强扣')), '只写审计：审计里记明不强扣口径');
});

test('积分：套餐配置（五年卡下架下单被拒、改赠分新单快照随变、推荐标记可读）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_shelf');
  // 五年卡下架（注入配置）→ 下单被拒，不产生订单
  const offShelf = {
    ...AppConfig,
    pricing: AppConfig.pricing.map((p) => (p.id === 'fiveYear' ? { ...p, onShelf: false } : p)),
  };
  let err = null;
  try { await core.payment.createOrder(db, uid, 'fiveYear', { now: T0, config: offShelf }); } catch (e) { err = e; }
  assert(err && err.code === 'plan-not-found', '下架档位下单应以 plan-not-found 拒绝');
  assert.eq(await db.collection(COLLECTIONS.Order).count({}), 0, '拒绝后未产生订单');
  // 改价/改赠分 → 新单快照随变
  const changed = {
    ...AppConfig,
    pricing: [{ id: 'month', name: '月卡', priceFen: 1, days: 30, grantPoints: 99, recommended: false, onShelf: true }],
  };
  const o = await core.payment.createOrder(db, uid, 'month', { now: T0, config: changed });
  assert.eq(o.amountFen, 1, '新单金额=改后配置价');
  assert.eq(o.grantPoints, 99, '新单赠分快照=改后配置');
  // 推荐标记可读
  const plans = await core.payment.resolvePricing(db);
  assert(plans.find((p) => p.id === 'year').recommended === true, '年卡推荐标记可读');
  assert(plans.find((p) => p.id === 'month').recommended === false, '月卡无推荐标记');
  // 老板平台写接口：新字段校验与落库
  const BOSS = 'boss_pts';
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
  const wr = await core.admin.updatePricing(db, BOSS, [
    { id: 'month', name: '月卡', priceFen: 1000, days: 30, grantPoints: 33, recommended: true, onShelf: false },
  ]);
  assert.eq(wr.pricing[0].grantPoints, 33, '赠分经写接口落库');
  assert.eq(wr.pricing[0].onShelf, false, '下架开关经写接口落库');
  const eff = await core.payment.resolvePricing(db);
  assert.eq(eff[0].grantPoints, 33, '生效档位读到新赠分');
  assert.eq(eff[0].onShelf, false, '生效档位读到下架');
  err = null;
  try {
    await core.admin.updatePricing(db, BOSS, [{ id: 'x', name: 'x', priceFen: 1, days: 1, grantPoints: -1 }]);
  } catch (e) { err = e; }
  assert(err && err.code === 'bad-config', '赠分负数应以 bad-config 拒绝');
});

test('积分：平台购买开关解析（iOS 关闭不影响 Android）', async () => {
  const custom = {
    ...AppConfig,
    payment: { platforms: { ios: { purchaseEnabled: false }, android: { purchaseEnabled: true } } },
  };
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(custom, 'ios'), false, 'iOS 关闭时解析为 false');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(custom, 'IOS'), false, '平台名大小写不敏感');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(custom, 'android'), true, 'Android 不受影响');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(AppConfig, 'ios'), true, '默认配置 iOS 开启');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(AppConfig, 'android'), true, '默认配置 Android 开启');
  assert.eq(core.payment.resolvePlatformPurchaseEnabled(AppConfig, 'windows'), true, '未配置的终端默认开启');
});

test('积分：流水可对账（余额=流水累加=末笔 balanceAfter，含来源/时间/订单号）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'pts_audit');
  await core.points.grantRegisterBonus(db, uid);
  const r = await core.payment.purchase(db, uid, 'month', { adapter: mockOk(), now: T0 });
  await core.points.spend(db, uid, AppConfig.points.photoImportCost, { kind: 'photo_import', refId: 'job-audit' });
  const list = await core.points.listLedger(db, uid);
  assert(list.length >= 3, '流水条数齐全');
  const sum = list.reduce((s, e) => s + e.delta, 0);
  assert.eq(sum, await core.points.getBalance(db, uid), '流水累加=当前余额');
  const oldestFirst = [...list].reverse();
  assert.eq(oldestFirst[oldestFirst.length - 1].balanceAfter, sum, '末笔 balanceAfter=余额');
  for (const e of list) {
    assert(e.createdAt > 0 && e.kind && e.refId !== undefined, '每条流水含时间/来源/订单号');
  }
  const grantEntry = list.find((e) => e.kind === 'plan_grant');
  assert.eq(grantEntry.refId, r.order.outTradeNo, '套餐赠送流水带订单号');
  // 倒序：最新在上
  for (let i = 1; i < list.length; i++) {
    assert(list[i - 1].createdAt >= list[i].createdAt, '流水按时间倒序');
  }
});
