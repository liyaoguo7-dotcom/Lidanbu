/** 补强测试（阶段1有条件验收：一、二、三） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

/** 断言"被拒绝且错误类型为无权限" */
async function assertDenied(promise, label) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `${label}：应抛错`);
  assert(
    err.message.includes('无权限'),
    `${label}：错误类型应为"无权限"，实际为：${err.message}`
  );
}

/* ---------- 一.1 删除对照 ---------- */
test('无删除开关：调用删除被拒绝且记录仍在；有开关时删除成功', async () => {
  const db = await h.newDB();
  const { owner, ev, c1, r1 } = await h.setupOwner(db);
  const { member, membershipId } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true, add: true, edit: true },
  });
  await assertDenied(
    core.receive.deleteRecord(db, member, owner, r1),
    '无del开关删除'
  );
  const still = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: r1 });
  assert(still, '被拒绝后记录必须仍在');
  // 对照：加上 del 开关后删除成功
  await core.share.updateGrant(db, owner, membershipId, { switches: { view: true, del: true } });
  await core.receive.deleteRecord(db, member, owner, r1);
  const gone = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: r1 });
  assert(!gone, '有del开关时删除应成功');
});

/* ---------- 一.2 导出对照 ---------- */
test('无导出开关拒绝导出；有开关时只导出授权范围', async () => {
  const db = await h.newDB();
  const { owner, ev: evA, c1 } = await h.setupOwner(db);
  const evB = await core.receive.createEvent(db, owner, owner, { name: '未授权宴', tagId: 'qita', date: '2026-10-02' });
  await core.receive.createRecord(db, owner, owner, evB._id, { contactId: c1, amount: 200000, type: '微信', date: '2026-10-02' });
  // 成员：授权事件A，无送礼，无export开关
  const { member, membershipId } = await h.setupMember(db, owner, {
    events: [evA], switches: { view: true },
  });
  await assertDenied(core.export.exportData(db, member, owner, {}), '无export开关导出');

  // 对照：打开 export 开关
  await core.share.updateGrant(db, owner, membershipId, { switches: { view: true, export: true } });
  const out = await core.export.exportData(db, member, owner, {});
  assert.eq(out.records.length, 1, '只导出授权事件A的1条');
  assert.eq(out.records[0].amount, 100000, '应为事件A的记录');
  assert.eq(out.gifts.length, 0, '送礼未授权，导出不含送礼');

  // 对照：送礼授权后导出含送礼
  await core.share.updateGrant(db, owner, membershipId, {
    switches: { view: true, export: true }, scope: { events: [evA], gifts: true },
  });
  const out2 = await core.export.exportData(db, member, owner, {});
  assert.eq(out2.gifts.length, 1, '送礼授权后导出应含送礼');
});

/* ---------- 一.3 移除后逐项失效 ---------- */
test('移除成员后：读明细/搜索/统计/时间线/导出全部立即失效', async () => {
  const db = await h.newDB();
  const { owner, ev, c1 } = await h.setupOwner(db);
  const { member, membershipId } = await h.setupMember(db, owner, {
    events: [ev], gifts: true, switches: { view: true, export: true },
  });
  await core.share.removeMember(db, owner, membershipId);

  await assertDenied(core.receive.listRecords(db, member, owner, ev), '移除后读明细');
  const s = await core.contacts.searchContacts(db, member, owner, '张');
  assert.eq(s.length, 0, '移除后搜索应为空');
  const st = await core.stats.getWanglaiStats(db, member, owner, { preset: 'lastYear' });
  assert.eq(st.receiveTotal, 0, '移除后统计应为0');
  await assertDenied(core.stats.getContactTimeline(db, member, owner, c1), '移除后时间线');
  await assertDenied(core.export.exportData(db, member, owner, {}), '移除后导出');
});

/* ---------- 一.4 笔数差额只含授权 ---------- */
test('成员往来统计：笔数、差额都只含授权数据', async () => {
  const db = await h.newDB();
  const { owner, ev: evA, c1 } = await h.setupOwner(db);
  const evB = await core.receive.createEvent(db, owner, owner, { name: '未授权宴', tagId: 'qita', date: '2026-10-02' });
  await core.receive.createRecord(db, owner, owner, evB._id, { contactId: c1, amount: 200000, type: '微信', date: '2026-10-02' });
  const { member } = await h.setupMember(db, owner, {
    events: [evA], switches: { view: true },
  });
  const st = await core.stats.getWanglaiStats(db, member, owner, { preset: 'lastYear' });
  assert.eq(st.receiveCount, 1, '笔数只含授权事件');
  assert.eq(st.giftCount, 0, '送礼未授权笔数为0');
  assert.eq(st.diff, 100000, '差额只含授权数据');
  assert.eq(st.isMember, true, '成员标识');
});

/* ---------- 一.5 无查看权限不能增删改 ---------- */
test('无查看权限：新增/修改/删除一律拒绝', async () => {
  const db = await h.newDB();
  const { owner, ev, c1, r1 } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member_noview');
  // 直接写 DB 构造 view=false 的授权（invite 会强制 view=true）
  const ms = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId: owner, memberId: member, status: 'active', createdAt: Date.now(),
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId: ms._id,
    switches: { view: false, add: true, edit: true, del: true },
    scope: { events: [ev], gifts: true },
    updatedAt: Date.now(),
  });
  await assertDenied(
    core.receive.createRecord(db, member, owner, ev, { contactId: c1, amount: 100, type: '现金', date: '2026-10-01' }),
    '无view新增'
  );
  await assertDenied(core.receive.updateRecord(db, member, owner, r1, { remark: 'x' }), '无view修改');
  await assertDenied(core.receive.deleteRecord(db, member, owner, r1), '无view删除');
});

/* ---------- 二.1 空身份 ---------- */
test('actorId或ownerId为空一律拒绝', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  let r = await core.authz.check(db, '', 'read', { kind: 'event', ownerId: owner, eventId: ev });
  assert(!r.ok, 'actorId空应拒绝');
  r = await core.authz.check(db, 'someone', 'read', { kind: 'event', ownerId: '', eventId: ev });
  assert(!r.ok, 'ownerId空应拒绝');
  r = await core.authz.check(db, null, 'read', { kind: 'event', ownerId: owner, eventId: ev });
  assert(!r.ok, 'actorId null应拒绝');
  const sc = await core.export.checkExportScope(db, '', owner);
  assert(!sc.ok, '导出空身份应拒绝');
});

/* ---------- 二.2 成员新增时联系人须可见 ---------- */
test('成员新增记录选用不可见联系人被拒绝', async () => {
  const db = await h.newDB();
  const { owner, ev: evA } = await h.setupOwner(db);
  // 联系人 C 只出现在未授权事件 B 中
  const cC = await core.contacts.createContact(db, owner, owner, { name: '陈六' });
  const evB = await core.receive.createEvent(db, owner, owner, { name: '未授权宴', tagId: 'qita', date: '2026-10-02' });
  await core.receive.createRecord(db, owner, owner, evB._id, { contactId: cC._id, amount: 10000, type: '现金', date: '2026-10-02' });
  const { member } = await h.setupMember(db, owner, {
    events: [evA], switches: { view: true, add: true },
  });
  // 成员在授权事件A里新增，但选用不可见联系人C
  await assertDenied(
    core.receive.createRecord(db, member, owner, evA, { contactId: cC._id, amount: 100, type: '现金', date: '2026-10-01' }),
    '选用不可见联系人'
  );
});

/* ---------- 二.3 未授权事件编号 ---------- */
test('成员传入未授权事件编号读取被拒绝', async () => {
  const db = await h.newDB();
  const { owner, ev: evA } = await h.setupOwner(db);
  const evB = await core.receive.createEvent(db, owner, owner, { name: '未授权宴', tagId: 'qita', date: '2026-10-02' });
  const { member } = await h.setupMember(db, owner, {
    events: [evA], switches: { view: true },
  });
  await assertDenied(core.receive.listRecords(db, member, owner, evB._id), '读未授权事件明细');
});

/* ---------- 二.4 缺字段明确拒绝不抛错 ---------- */
test('授权记录缺字段：明确拒绝，不抛未处理错误', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member_broken');
  const ms = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId: owner, memberId: member, status: 'active', createdAt: Date.now(),
  });
  // 缺 switches
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId: ms._id, scope: { events: [ev], gifts: false }, updatedAt: Date.now(),
  });
  let r = await core.authz.check(db, member, 'read', { kind: 'event', ownerId: owner, eventId: ev });
  assert(!r.ok, '缺switches应拒绝');
  // 缺 scope
  await db.collection(COLLECTIONS.ShareGrant).update(
    { membershipId: ms._id }, { switches: { view: true }, scope: undefined }
  );
  r = await core.authz.check(db, member, 'read', { kind: 'event', ownerId: owner, eventId: ev });
  assert(!r.ok, '缺scope应拒绝');
});

/* ---------- 三、额度池预留 ---------- */
test('额度含receivePool字段；邀请奖励规则进配置', async () => {
  const cfg = core.config;
  assert.eq(cfg.inviteReward.rules.perInvite.receivePool, 10, '每邀请收礼池+10');
  assert.eq(cfg.inviteReward.rules.perInvite.giftRecords, 5, '每邀请送礼+5');
  assert.eq(cfg.inviteReward.rules.maxInvites, 10, '上限预留10');
  assert.eq(cfg.inviteReward.enabled, false, '当前未启用');
  const q = core.quota.getInviteRewardQuota('u');
  assert.eq(q.receivePool, 0, '当前邀请奖励固定返回0');
  const user = { _id: 'u', membership: { status: 'free' } };
  const eff = core.quota.getEffectiveQuota(user);
  assert('receivePool' in eff, '有效额度应含receivePool');
  assert.eq(eff.receivePool, 0, '当前池为0');
  assert.eq(eff.recordsPerEvent, 30, '每礼薄上限仍为30');
});

test('池为0时第31条仍被拦截（行为不变）', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1');
  const c = await core.contacts.createContact(db, owner, owner, { name: '甲' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '宴', tagId: 'qita', date: '2026-10-01' });
  for (let i = 0; i < 30; i++) {
    await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  }
  let err = null;
  try {
    await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  } catch (e) { err = e; }
  assert(err && err.message.includes('quota-exceeded'), '池为0时第31条应被拦截');
});
