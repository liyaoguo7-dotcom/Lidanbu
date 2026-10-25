/** AL-5 行为测试：电子请柬/家庭共享总开关（2026-10-25 用户加）
 * 默认开（不改变现行行为）；老板平台 updateLaunchSwitches 落库后
 * core/features.resolveFlags 读到新值且不冲掉其他闸；家庭共享关后
 * share 管理/列表接口以 family-share-closed 拒绝；非管理员不能改闸。 */
const { test, assert } = require('./fw');
const { newDB, newUser } = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const BOSS = 'boss_al5';

async function seed(db) {
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
  await newUser(db, BOSS);
  await newUser(db, 'user_al5');
}

test('AL-5 总开关默认值：请柬开/共享开/拍照关（与现行行为一致）', async () => {
  const db = await newDB(); await seed(db);
  const f = await core.features.resolveFlags(db);
  assert(f.photoImport === false && f.eInvitation === true && f.familyShare === true, '默认应为 ' + JSON.stringify(f));
});

test('AL-5 改闸落库且互不冲掉：关共享后再开拍照，共享仍关', async () => {
  const db = await newDB(); await seed(db);
  let r = await core.admin.updateLaunchSwitches(db, BOSS, { familyShareEnabled: false });
  assert(r.familyShareEnabled === false, '关共享应落库');
  assert(r.eInvitationEnabled === true, '请柬不应受影响');
  r = await core.admin.updateLaunchSwitches(db, BOSS, { photoImportEnabled: true });
  assert(r.photoImportEnabled === true, '开拍照应落库');
  assert(r.familyShareEnabled === false, '改拍照闸不应冲掉共享闸');
  const f = await core.features.resolveFlags(db);
  assert(f.familyShare === false && f.photoImport === true, '生效值应为关共享/开拍照');
});

test('AL-5 家庭共享关后 share 接口拒绝（family-share-closed），开时正常', async () => {
  const db = await newDB(); await seed(db);
  const okList = await core.share.listReceived(db, 'user_al5');
  assert(Array.isArray(okList), '开时列表应正常返回数组');
  await core.admin.updateLaunchSwitches(db, BOSS, { familyShareEnabled: false });
  let code = '';
  try { await core.share.listReceived(db, 'user_al5'); } catch (e) { code = e.code || e.message; }
  assert(code === 'family-share-closed', '应以 family-share-closed 拒绝，实际 ' + code);
  let code2 = '';
  try { await core.share.listMembers(db, 'user_al5'); } catch (e) { code2 = e.code || e.message; }
  assert(code2 === 'family-share-closed', '成员列表也应拒绝，实际 ' + code2);
});

test('AL-5 非管理员改闸被拒；非法值被拒', async () => {
  const db = await newDB(); await seed(db);
  let threw = false;
  try { await core.admin.updateLaunchSwitches(db, 'user_al5', { familyShareEnabled: false }); } catch (e) { threw = true; }
  assert(threw, '非管理员应被拒');
  threw = false;
  try { await core.admin.updateLaunchSwitches(db, BOSS, { familyShareEnabled: 'yes' }); } catch (e) { threw = true; }
  assert(threw, '非布尔值应被拒');
});
