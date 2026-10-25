/** 会员额度按档位分（2026-10-25 用户定案，高风险：额度拦截口径）
 * - 每档位各带一组四数字（礼薄/每薄/送礼/联系人），用户生效额度 =
 *   其所持档位的那组；购买发货时把 planId 记进 membership。
 * - 存量会员（membership 无 planId）按最近一笔已支付套餐订单推导档位。
 * - 无档位会员（后台手动开通等）走全局会员额度 memberQuota 兜底。
 * - 老板平台落库的档位额度优先于静态配置，保存即生效。
 * - 四项再受 safetyCaps 防滥用上限封顶（getEffectiveQuota 层已验，此处验链路）。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

const BOSS = 'boss_pq';
const FUTURE = Date.now() + 30 * 86400e3;

async function seedAdmin(db) {
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
  await h.newUser(db, BOSS);
}

test('档位额度：购买月卡后 planId 落 membership、额度按月卡组拦截', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'buyer_month');
  const adapter = new core.payAdapter.MockPayAdapter({ result: 'success' });
  await core.payment.purchase(db, uid, 'month', { adapter });
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: uid });
  assert.eq(user.membership.planId, 'month', '发货应把所购档位记进 membership.planId');
  // 月卡送礼额度 200：塞满 200 条后 checkAddQuota 应拦截第 201 条
  const docs = [];
  for (let i = 0; i < 200; i++) docs.push({ ownerId: uid, contactId: 'c', amount: 100, createdAt: i });
  for (const d of docs) await db.collection(COLLECTIONS.GiftRecord).insert(d);
  const chk = await core.quota.checkAddQuota(db, user, 'gift');
  assert.eq(chk.ok, false, '月卡送礼满 200 应拦截');
  assert.eq(chk.reason, 'quota-exceeded:gift', '拦截原因码');
  // 礼薄额度 10：9 本时可建、10 本时拦截
  for (let i = 0; i < 9; i++) await db.collection(COLLECTIONS.ReceiveEvent).insert({ ownerId: uid, name: '薄', createdAt: i });
  assert.eq((await core.quota.checkAddQuota(db, user, 'event')).ok, true, '月卡第 10 本礼薄可建');
  await db.collection(COLLECTIONS.ReceiveEvent).insert({ ownerId: uid, name: '薄', createdAt: 99 });
  assert.eq((await core.quota.checkAddQuota(db, user, 'event')).ok, false, '月卡第 11 本礼薄应拦截');
});

test('档位额度：存量会员无 planId 时按最近已支付订单推导档位', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'legacy_member', { status: 'member', expireAt: FUTURE, graceUntil: null });
  await db.collection(COLLECTIONS.Order).insert({
    userId: uid, kind: 'plan', planId: 'decade', status: 'paid', createdAt: Date.now() - 1000,
  });
  const base = await core.quota.resolveMemberBaseQuota(db, { _id: uid, membership: { status: 'member', expireAt: FUTURE } });
  assert(base, '应解析出基础额度');
  assert.eq(base.receiveEvents, 50, '十年卡礼薄 50');
  assert.eq(base.giftRecords, 1000, '十年卡送礼 1000');
});

test('档位额度：无档位会员走全局会员额度兜底（落库 memberQuota 优先）', async () => {
  const db = await h.newDB();
  await seedAdmin(db);
  await db.collection(COLLECTIONS.AppConfig).update({ _id: 'singleton' }, {
    memberQuota: { receiveEvents: 7, recordsPerEvent: 70, giftRecords: 70, contacts: 70 },
  });
  const member = { _id: 'manual_member', membership: { status: 'member', expireAt: FUTURE, graceUntil: null } };
  const base = await core.quota.resolveMemberBaseQuota(db, member);
  assert.eq(base.receiveEvents, 7, '兜底应取落库 memberQuota 而非静态 30');
  assert.eq(base.contacts, 70, '兜底联系人 70');
});

test('档位额度：老板平台改档位额度保存即生效（落库优先于静态）', async () => {
  const db = await h.newDB();
  await seedAdmin(db);
  const plans = (await core.payment.resolvePricing(db)).map((p) => ({ ...p }));
  const month = plans.find((p) => p.id === 'month');
  month.quota = { receiveEvents: 3, recordsPerEvent: 30, giftRecords: 30, contacts: 30 };
  await core.admin.updatePricing(db, BOSS, plans);
  const member = { _id: 'm1', membership: { status: 'member', expireAt: FUTURE, graceUntil: null, planId: 'month' } };
  const base = await core.quota.resolveMemberBaseQuota(db, member);
  assert.eq(base.receiveEvents, 3, '月卡礼薄应按刚保存的 3 生效');
  assert.eq(base.giftRecords, 30, '月卡送礼应按刚保存的 30 生效');
  // 静态档位经 resolvePricing 仍带默认额度（normalizePlan 不丢 quota）
  const db2 = await h.newDB();
  const staticPlans = await core.payment.resolvePricing(db2);
  const sm = staticPlans.find((p) => p.id === 'month');
  assert(sm.quota && sm.quota.receiveEvents === 10 && sm.quota.giftRecords === 200, '静态月卡额度 10/200 应经 resolvePricing 带出');
});

test('档位额度：updatePricing 校验——额度缺项/非法被拒、合法整组保存', async () => {
  const db = await h.newDB();
  await seedAdmin(db);
  const plans = (await core.payment.resolvePricing(db)).map((p) => ({ ...p }));
  const bad = plans.map((p) => ({ ...p }));
  bad[0].quota = { receiveEvents: 10, recordsPerEvent: 200, giftRecords: 200 }; // 缺 contacts
  let err = null;
  try { await core.admin.updatePricing(db, BOSS, bad); } catch (e) { err = e; }
  assert(err, '额度缺项应被拒');
  const bad2 = plans.map((p) => ({ ...p }));
  bad2[0].quota = { receiveEvents: -1, recordsPerEvent: 200, giftRecords: 200, contacts: 200 };
  err = null;
  try { await core.admin.updatePricing(db, BOSS, bad2); } catch (e) { err = e; }
  assert(err, '额度负数应被拒');
  const ok = await core.admin.updatePricing(db, BOSS, plans);
  assert(ok.pricing.find((p) => p.id === 'year').quota.contacts === 500, '合法整组额度应原样保存');
});
