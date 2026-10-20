/**
 * 本地演示数据测试（任务D）：种子数据集完整性 + 演示会员状态切换。
 * demo-seed 不依赖 wx：用 MemoryDB + core 注入直接验。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const demoSeed = require('../miniprogram/services/demo-seed');

const TIERS = new Set([50000, 100000, 200000, 300000, 400000, 1000000]);

test('演示种子：亲友12/礼薄3/收礼21/送礼8，全带 seed 标记，金额整档、日期在近一年内', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'demo1'); // 免费用户：种子必须在免费额度内种得下
  const r = await demoSeed.seedDemoData(db, core, uid);
  assert.eq(r.skipped, false, '首次应种下');
  assert.eq(r.contacts, 12, '亲友 12 位');
  assert.eq(r.events, 3, '礼薄 3 个');
  assert.eq(r.records, 21, '收礼记录 21 条');
  assert.eq(r.gifts, 8, '送礼记录 8 条');

  const C = COLLECTIONS;
  const contacts = await db.collection(C.Contact).find({ ownerId: uid });
  assert.eq(contacts.length, 12, '亲友落库 12');
  assert(contacts.every((c) => c.seed === true), '亲友全带 seed:true');
  assert(contacts.some((c) => c.name === '欧阳修远'), '含欧阳修远');

  const events = await db.collection(C.ReceiveEvent).find({ ownerId: uid });
  assert.eq(events.length, 3, '礼薄落库 3');
  assert(events.every((e) => e.seed === true), '礼薄全带 seed:true');
  const byName = Object.fromEntries(events.map((e) => [e.name, e]));
  assert(byName['张三的婚礼'] && byName['赵六的乔迁宴'] && byName['王老太爷丧礼'], '三个礼薄齐全');
  assert.eq(byName['张三的婚礼'].tagId, 'jiehun', '婚礼是结婚标签');
  assert.eq(byName['王老太爷丧礼'].tagId, 'baishi', '丧礼是白事标签');

  const records = await db.collection(C.ReceiveRecord).find({ ownerId: uid });
  assert.eq(records.length, 21, '收礼落库 21');
  assert(records.every((x) => x.seed === true), '收礼全带 seed:true');
  assert(records.every((x) => TIERS.has(x.amount)), '收礼金额全是整档');
  assert.eq(records.filter((x) => x.eventId === byName['张三的婚礼']._id).length, 12, '婚礼 12 条');
  assert.eq(records.filter((x) => x.eventId === byName['王老太爷丧礼']._id).length, 4, '丧礼 4 条');

  const gifts = await db.collection(C.GiftRecord).find({ ownerId: uid });
  assert.eq(gifts.length, 8, '送礼落库 8');
  assert(gifts.every((x) => x.seed === true && TIERS.has(x.amount)), '送礼全带标记且金额整档');
  assert.eq(gifts.filter((x) => x.tagId === 'baishi').length, 1, '含一条白事奠仪送礼');

  // 日期都落在近一年内（往来页默认范围能出数据）
  const today = demoSeed.dateDaysAgo(0);
  const yearAgo = demoSeed.dateDaysAgo(365);
  const allDates = [...records, ...gifts].map((x) => x.date);
  assert(allDates.every((d) => d >= yearAgo && d <= today), '日期全在近一年内');
});

test('演示种子：重复种不叠加（已有 seed 标记即跳过整套）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'demo2');
  await demoSeed.seedDemoData(db, core, uid);
  const r2 = await demoSeed.seedDemoData(db, core, uid);
  assert.eq(r2.skipped, true, '第二次跳过');
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: uid }), 12, '亲友仍 12 位');
  assert.eq(await db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId: uid }), 3, '礼薄仍 3 个');
});

test('演示会员切换：free/member/grace 三态都经现行 getMembershipState 计算', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'demo3');
  assert.eq(await demoSeed.applyDemoMembership(db, core, uid, 'member'), 'member', '切会员');
  assert.eq(await demoSeed.applyDemoMembership(db, core, uid, 'grace'), 'grace', '切已到期（缓冲期）');
  assert.eq(await demoSeed.applyDemoMembership(db, core, uid, 'free'), 'free', '切回免费');
});

test('演示会员切换：额度随状态走现行公式（会员额度大于免费，缓冲期回落免费）', async () => {
  const db = await h.newDB();
  const uid = await h.newUser(db, 'demo4');
  const user = () => db.collection(COLLECTIONS.User).findOne({ _id: uid });
  await demoSeed.applyDemoMembership(db, core, uid, 'free');
  const freeQ = core.quota.getEffectiveQuota(await user());
  await demoSeed.applyDemoMembership(db, core, uid, 'member');
  const memberQ = core.quota.getEffectiveQuota(await user());
  assert(memberQ.receiveEvents > freeQ.receiveEvents, '会员礼薄额度应大于免费');
  assert(memberQ.giftRecords > freeQ.giftRecords, '会员送礼额度应大于免费');
  await demoSeed.applyDemoMembership(db, core, uid, 'grace');
  const graceQ = core.quota.getEffectiveQuota(await user());
  assert.eq(graceQ.receiveEvents, freeQ.receiveEvents, '缓冲期额度回落到免费口径');
});
