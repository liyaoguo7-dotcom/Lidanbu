/** 会员专属功能：家庭共享邀请门禁 + 到期共享暂停（默认实现，待用户确认） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

/** 断言"被拒绝且错误类型为需要开通会员"（与无权限区分） */
async function assertMemberRequired(promise, label) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `${label}：应抛错`);
  assert(
    err.message.includes('需要开通会员'),
    `${label}：错误类型应为"需要开通会员"，实际：${err.message}`
  );
  assert(!err.message.includes('无权限'), `${label}：不应与"无权限"混淆`);
  assert.eq(err.code, 'member-required', `${label}：code应为member-required`);
}

test('普通用户发起邀请被拒（需要开通会员），数据未变', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free_owner'); // 普通用户
  const msBefore = await db.collection(COLLECTIONS.ShareMembership).count({});
  await assertMemberRequired(
    core.share.invite(db, owner, { switches: { view: true }, scope: { gifts: true } }),
    '普通用户邀请'
  );
  const msAfter = await db.collection(COLLECTIONS.ShareMembership).count({});
  assert.eq(msAfter, msBefore, '拒绝后数据未变：未产生邀请');
});

test('会员发起邀请成功', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db); // setupOwner 默认为会员
  const inv = await core.share.invite(db, owner, {
    switches: { view: true }, scope: { events: [ev] },
  });
  assert(inv.membershipId, '会员邀请应成功');
});

test('缓冲期内：不能新邀请，但已有成员照常访问', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true },
  });
  // 进入缓冲期
  await db.collection(COLLECTIONS.User).update(
    { _id: owner },
    { membership: { status: 'member', expireAt: Date.now() - 1000 } }
  );
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: owner });
  assert.eq(core.quota.getMembershipState(user), 'grace', '应在缓冲期');
  // 不能新邀请
  await assertMemberRequired(
    core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev] } }),
    '缓冲期内新邀请'
  );
  // 已有成员照常访问
  const evs = await core.receive.listEvents(db, member, owner);
  assert.eq(evs.length, 1, '缓冲期内已有成员照常访问');
  const st = await core.stats.getWanglaiStats(db, member, owner, { preset: 'custom', from: '2026-01-01', to: '2026-12-31' });
  assert(st.receiveTotal > 0, '缓冲期内成员统计照常');
});

test('缓冲期结束后：成员访问被拒，数据保留；续费后恢复', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true, export: true },
  });
  // 过期超过缓冲期
  await db.collection(COLLECTIONS.User).update(
    { _id: owner },
    { membership: { status: 'member', expireAt: Date.now() - 100 * 86400e3 } }
  );
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: owner });
  assert.eq(core.quota.getMembershipState(user), 'expired', '应已过缓冲期');
  // 成员访问被拒
  const evs = await core.receive.listEvents(db, member, owner);
  assert.eq(evs.length, 0, '过期后成员看不到事件');
  let err = null;
  try { await core.receive.listRecords(db, member, owner, ev); } catch (e) { err = e; }
  assert(err && err.message.includes('无权限'), '过期后成员读明细应被拒');
  const st = await core.stats.getWanglaiStats(db, member, owner, { preset: 'custom', from: '2026-01-01', to: '2026-12-31' });
  assert.eq(st.receiveTotal, 0, '过期后成员统计为0');
  try { await core.export.exportData(db, member, owner, {}); err = null; } catch (e) { err = e; }
  assert(err && err.message.includes('无权限'), '过期后成员导出应被拒');
  // 数据一律保留
  const recCnt = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId: owner });
  assert.eq(recCnt, 1, '数据一律保留：收礼记录仍在');
  // 续费后自动恢复
  await db.collection(COLLECTIONS.User).update(
    { _id: owner },
    { membership: { status: 'member', expireAt: Date.now() + 30 * 86400e3 } }
  );
  const evs2 = await core.receive.listEvents(db, member, owner);
  assert.eq(evs2.length, 1, '续费后自动恢复');
});

test('被邀请的普通用户能正常访问授权范围', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  // setupMember 建的 member1 为普通用户（newUser 默认 free）
  const { member } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true },
  });
  const mUser = await db.collection(COLLECTIONS.User).findOne({ _id: member });
  assert.eq(core.quota.getMembershipState(mUser), 'free', '成员为普通用户');
  const evs = await core.receive.listEvents(db, member, owner);
  assert.eq(evs.length, 1, '普通用户成员可访问授权范围');
  const recs = await core.receive.listRecords(db, member, owner, ev);
  assert.eq(recs.length, 1, '普通用户成员可读明细');
});

test('memberOnlyFeatures 配置含三项', async () => {
  const f = core.config.memberOnlyFeatures;
  assert(f.includes('familyShareInvite'), '含家庭共享邀请');
  assert(f.includes('photoImport'), '含拍照导入');
  assert(f.includes('landscapeMode'), '含横置礼簿模式');
});
