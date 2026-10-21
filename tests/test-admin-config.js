/** 老板平台配置写接口测试（阶段5补缺）：管理员校验 + 输入校验 + 审计 + 三件套 */
const { test, assert } = require('./fw');
const { newDB } = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const admin = core.admin;

const BOSS = 'boss_openid_1';
const NOBODY = 'random_user_1';

async function seedAdmin(db) {
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
}

async function configAudits(db) {
  return db.collection(COLLECTIONS.AuditLog).find({ action: 'config' });
}

test('admin配置：getConfig 管理员可读（静态默认+pricing 回落定版），非管理员被拒', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const r = await admin.getConfig(db, BOSS);
  assert.eq(r.freeQuota.receiveEvents, core.config.freeQuota.receiveEvents, '免费礼薄数=静态默认');
  assert.eq(r.freeQuota.contacts, core.config.freeQuota.contacts, '免费亲友数=静态默认');
  assert.eq(r.pricing.length, (core.config.pricing || []).length, '价格档位回落静态定版（用户已定四档）');
  assert(r.memberOnlyFeatures.includes('familyShareInvite'), '会员专属清单含家庭共享邀请');
  let err = null;
  try { await admin.getConfig(db, NOBODY); } catch (e) { err = e; }
  assert(err && err.code === 'not-admin', '非管理员原因码 not-admin');
  assert(/无权限/.test(err.message), '拒绝文案用户可读');
});

test('admin配置：改价格档位三件套（成功/非管理员拒/拒后未变+审计只记成功）', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const plans = [{ id: 'month', name: '月度会员', priceFen: 1200, days: 30 }];
  const r = await admin.updatePricing(db, BOSS, plans);
  assert.eq(r.pricing[0].priceFen, 1200, '返回新档位价格');
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  assert.eq(doc.pricing[0].id, 'month', '档位已落库');
  const logs = await configAudits(db);
  assert.eq(logs.length, 1, '写了1条配置审计');
  assert.eq(logs[0].targetId, 'pricing', '审计对象 pricing');
  // 非管理员改 → 拒，数据未变，审计不新增
  let err = null;
  try { await admin.updatePricing(db, NOBODY, [{ id: 'hack', name: 'x', priceFen: 1, days: 1 }]); } catch (e) { err = e; }
  assert(err && err.code === 'not-admin', '非管理员被拒');
  const doc2 = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  assert.eq(doc2.pricing.length, 1, '拒绝后档位条数未变');
  assert.eq(doc2.pricing[0].id, 'month', '拒绝后档位内容未变');
  assert.eq((await configAudits(db)).length, 1, '拒绝后审计未新增');
});

test('admin配置：价格档位非法输入被拒且未落库', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const bad = [
    [{ id: 'a', name: 'x', priceFen: -1, days: 30 }],
    [{ id: 'a', name: 'x', priceFen: 100, days: 0 }],
    [{ id: 'a', name: 'x', priceFen: 100, days: 30 }, { id: 'a', name: 'y', priceFen: 100, days: 30 }],
    [{ id: 'BAD ID!', name: 'x', priceFen: 100, days: 30 }],
    [{ id: 'a', name: '', priceFen: 100, days: 30 }],
  ];
  let n = 0;
  for (const p of bad) {
    try { await admin.updatePricing(db, BOSS, p); } catch (e) { n++; assert.eq(e.code, 'bad-config', '原因码 bad-config'); }
  }
  assert.eq(n, bad.length, '全部非法输入都被拒');
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  assert(!doc.pricing, '非法输入未落库');
  assert.eq((await configAudits(db)).length, 0, '非法输入未写审计');
});

test('admin配置：功能开关与会员专属清单（成功+未知项拒+非管理员拒后未变）', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const r1 = await admin.updateFeatureSwitches(db, BOSS, { photoImport: false });
  assert.eq(r1.membershipFeatures.photoImport, false, '拍照导入开关已关');
  assert.eq(r1.membershipFeatures.redLedgerMode, true, '未改的开关保持默认开');
  let e1 = null;
  try { await admin.updateFeatureSwitches(db, BOSS, { nope: true }); } catch (e) { e1 = e; }
  assert(e1 && e1.code === 'bad-config', '未知开关被拒');
  const r2 = await admin.updateMemberOnlyFeatures(db, BOSS, ['familyShareInvite']);
  assert.eq(r2.memberOnlyFeatures.join(','), 'familyShareInvite', '专属清单已改');
  let e2 = null;
  try { await admin.updateMemberOnlyFeatures(db, NOBODY, ['photoImport']); } catch (e) { e2 = e; }
  assert(e2 && e2.code === 'not-admin', '非管理员改清单被拒');
  const back = await admin.getConfig(db, BOSS);
  assert.eq(back.memberOnlyFeatures.join(','), 'familyShareInvite', '拒绝后清单未变');
  let e3 = null;
  try { await admin.updateMemberOnlyFeatures(db, BOSS, ['flyToMoon']); } catch (e) { e3 = e; }
  assert(e3 && e3.code === 'bad-config', '未知功能名被拒');
});

test('admin配置：额度设置（成功读回+非法值拒后未变）', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const r = await admin.updateQuotaSettings(db, BOSS, { freeQuota: { contacts: 60 } });
  assert.eq(r.freeQuota.contacts, 60, '免费亲友额度改 60');
  assert.eq(r.freeQuota.receiveEvents, core.config.freeQuota.receiveEvents, '未改项保持默认');
  const back = await admin.getConfig(db, BOSS);
  assert.eq(back.freeQuota.contacts, 60, '读回 60');
  let err = null;
  try { await admin.updateQuotaSettings(db, BOSS, { freeQuota: { contacts: -5 } }); } catch (e) { err = e; }
  assert(err && err.code === 'bad-config', '负数被拒');
  assert.eq((await admin.getConfig(db, BOSS)).freeQuota.contacts, 60, '拒绝后未变');
  let err2 = null;
  try { await admin.updateQuotaSettings(db, BOSS, {}); } catch (e) { err2 = e; }
  assert(err2 && err2.code === 'bad-config', '空修改被拒');
});

test('admin配置：未配置管理员名单时一律拒绝（fail closed）', async () => {
  const db = await newDB();
  assert.eq(await admin.isAdmin(db, BOSS), false, '无名单时 isAdmin=false');
  let n = 0;
  try { await admin.getConfig(db, BOSS); } catch (e) { n++; }
  try { await admin.updatePricing(db, BOSS, []); } catch (e) { n++; }
  try { await admin.updateFeatureSwitches(db, BOSS, { photoImport: true }); } catch (e) { n++; }
  assert.eq(n, 3, '无 appConfig 文档时读写都拒');
});
