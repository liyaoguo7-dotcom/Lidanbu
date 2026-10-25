/** AM批行为测试：会员功能名单真正接上——三功能两道闸逐组实测。
 * 口径（用户 2026-10-26 定）：总开关管功能开/关（所有人）；会员功能名单
 * 管算不算会员专属（名单含→非会员拦 member-required；不含→免费用户可用）。
 * 名单读不到/无文档时回退静态默认（三项全含）——与接线前行为一致。 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const landscapeRoute = require('../miniprogram/services/landscape-route.js');

const BOSS = 'am-boss';
const MEMBER = () => ({ status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });

async function dbWithBoss() {
  const db = await h.newDB();
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
  return db;
}

test('AM 名单解析：无文档回退三项全专属；老板保存后按名单；getFlags 带出名单与横置总闸', async () => {
  const db = await dbWithBoss();
  const def = await core.features.resolveMemberOnlyFeatures(db);
  assert.eq(def.join(','), 'familyShareInvite,photoImport,landscapeMode', '默认三项全专属');
  await core.admin.updateMemberOnlyFeatures(db, BOSS, ['photoImport']);
  const after = await core.features.resolveMemberOnlyFeatures(db);
  assert.eq(after.join(','), 'photoImport', '保存后只剩拍照导入算专属');
  const flags = await core.features.getFlags(db, BOSS);
  assert.eq(flags.memberOnly.join(','), 'photoImport', 'getFlags 带出名单');
  assert.eq(flags.landscape, true, 'getFlags 带出横置总闸默认开');
  await core.admin.updateLaunchSwitches(db, BOSS, { landscapeEnabled: false });
  const flags2 = await core.features.getFlags(db, BOSS);
  assert.eq(flags2.landscape, false, '总开关保存后横置闸关');
});

test('AM 家庭共享邀请：名单含→非会员被拦；名单去掉→非会员可邀；会员不受影响', async () => {
  const db = await dbWithBoss();
  const free = await h.newUser(db, 'am-free1');
  let err = null;
  try { await core.share.invite(db, free, { switches: { view: true }, scope: { events: [], gifts: true } }); } catch (e) { err = e; }
  assert(err && err.code === 'member-required', '默认名单下非会员邀请应被 member-required 拦下');

  await core.admin.updateMemberOnlyFeatures(db, BOSS, ['photoImport', 'landscapeMode']);
  const ok = await core.share.invite(db, free, { switches: { view: true }, scope: { events: [], gifts: true } });
  assert(ok && ok.membershipId, '名单去掉 familyShareInvite 后非会员可发出邀请');

  const db2 = await dbWithBoss();
  const mem = await h.newUser(db2, 'am-mem1', MEMBER());
  const ok2 = await core.share.invite(db2, mem, { switches: { view: true }, scope: { events: [], gifts: true } });
  assert(ok2 && ok2.membershipId, '默认名单下会员邀请正常');
});

test('AM 拍照导入：名单含→非会员被拦；名单去掉→非会员过会员关、积分关照旧', async () => {
  const db = await dbWithBoss();
  const free = await h.newUser(db, 'am-free2');
  await core.points.grant(db, free, 100, { kind: 'manual', refId: 'am-seed1', note: '测试' });
  let err = null;
  try { await core.importer.startImportTask(db, free, free, { jobId: 'am-job1', kind: 'gift', imagePath: 'wxfile://ok.jpg' }); } catch (e) { err = e; }
  assert(err && err.code === 'member-required', '默认名单下非会员导入应被 member-required 拦下');
  assert.eq(await core.points.getBalance(db, free), 100, '被拦时不扣分');

  await core.admin.updateMemberOnlyFeatures(db, BOSS, ['familyShareInvite', 'landscapeMode']);
  const broke = await h.newUser(db, 'am-free3');
  let err2 = null;
  try { await core.importer.startImportTask(db, broke, broke, { jobId: 'am-job2', kind: 'gift', imagePath: 'wxfile://ok.jpg' }); } catch (e) { err2 = e; }
  assert(err2 && err2.code !== 'member-required', '名单去掉 photoImport 后非会员不再被会员关拦');
  assert(err2 && err2.code === 'insufficient-points', '没积分时停在积分关（积分规则不变）');

  const r = await core.importer.startImportTask(db, free, free, { jobId: 'am-job3', kind: 'gift', imagePath: 'wxfile://ok.jpg' });
  assert.eq(r.cost, 5, '免费用户导入照旧扣 5 分');
  assert.eq(await core.points.getBalance(db, free), 95, '扣 5 剩 95');
});

test('AM 横置两道闸（客户端纯函数）：总关谁都进不去；名单去掉后非会员可进；取不到配置按旧行为', async () => {
  const member = { state: 'member' };
  const free = { state: 'free' };
  const all = { landscape: true, memberOnly: ['familyShareInvite', 'photoImport', 'landscapeMode'] };
  assert.eq(landscapeRoute.resolveLandscapeGate({ membership: member, flags: { ...all, landscape: false } }), 'master-off', '总开关关：会员也进不去');
  assert.eq(landscapeRoute.resolveLandscapeGate({ membership: free, flags: all }), 'member-only', '名单含：非会员拦');
  assert.eq(landscapeRoute.resolveLandscapeGate({ membership: member, flags: all }), 'ok', '名单含：会员放行');
  const noLand = { landscape: true, memberOnly: ['photoImport'] };
  assert.eq(landscapeRoute.resolveLandscapeGate({ membership: free, flags: noLand }), 'ok', '名单去掉：非会员放行');
  assert.eq(landscapeRoute.resolveLandscapeGate({ membership: free, flags: null }), 'member-only', '配置取不到：按算专属拦（旧行为）');
  assert.eq(landscapeRoute.resolveBookRoute({ landscapeOn: true, membership: free, flags: noLand }), 'landscape', '路由：名单去掉+个人开关开→横置');
  assert.eq(landscapeRoute.resolveBookRoute({ landscapeOn: true, membership: member, flags: { ...all, landscape: false } }), 'portrait', '路由：总关→竖置');
  assert.eq(landscapeRoute.resolveBookRoute({ landscapeOn: false, membership: member, flags: noLand }), 'portrait', '路由：个人开关关→竖置');
});
