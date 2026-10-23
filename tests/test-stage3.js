/** 阶段3：家庭共享权限三件套 / 成员视角事件 / 注销 / 到期提醒 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

async function assertPermDenied(promise, label) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `${label}：应抛错`);
  assert(err.message.includes('无权限'), `${label}：应为无权限拒绝，实际：${err.message}`);
}

// —— 邀请：有权限能成功 ——
test('阶段3：会员发起邀请成功（5开关+范围）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const inv = await core.share.invite(db, owner, {
    switches: { view: true, add: true, edit: false, del: false, export: false },
    scope: { events: [ev], gifts: true },
  });
  assert(inv.membershipId, '应返回 membershipId');
  const grant = await db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId: inv.membershipId });
  assert(grant.switches.view === true, '仅查看恒开');
  assert(grant.switches.export === false, '可导出默认关');
  assert(grant.scope.gifts === true, '范围含送礼');
});

// —— 邀请：范围为空被拒绝，数据未变 ——
test('阶段3：邀请范围为空被拒绝，数据未变', async () => {
  const db = await h.newDB();
  const { owner } = await h.setupOwner(db);
  const before = await db.collection(COLLECTIONS.ShareMembership).count({});
  let err = null;
  try {
    await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [], gifts: false } });
  } catch (e) { err = e; }
  assert(err && err.message.includes('至少勾选'), '范围为空应拒绝');
  assert.eq(await db.collection(COLLECTIONS.ShareMembership).count({}), before, '拒绝后数据未变');
});

// —— 仅查看不可取消 ——
test('阶段3：仅查看开关不可取消', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  let err = null;
  try {
    await core.share.invite(db, owner, { switches: { view: false }, scope: { events: [ev] } });
  } catch (e) { err = e; }
  assert(err && err.message.includes('不可取消'), 'view:false 应抛错');
});

// —— 改权限：有权限成功 / 无权限拒绝且数据未变 ——
test('阶段3：成员权限修改三件套', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, { events: [ev], switches: { view: true } });
  const inv = await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev] } });
  const msId = inv.membershipId;
  const grantBefore = JSON.stringify(await db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId: msId }));
  // 有权限：主人修改成功，立即生效
  await core.share.updateGrant(db, owner, msId, { switches: { view: true, add: true }, scope: { events: [ev], gifts: false } });
  const grantAfter = await db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId: msId });
  assert(grantAfter.switches.add === true, '修改应立即生效');
  // 无权限：成员自己不能改（非主人）——被拒绝且数据未变
  let denied = null;
  try {
    await core.share.updateGrant(db, member, msId, { switches: { view: true, del: true } });
  } catch (e) { denied = e; }
  assert(denied, '成员改他人账本权限应被拒绝');
  const grantFinal = JSON.stringify(await db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId: msId }));
  assert.eq(grantFinal, JSON.stringify(grantAfter), '拒绝后数据未变');
});

// —— 移除成员：记录保留 + createdBy 保留 ——
test('阶段3：移除成员后其新增记录保留并显示创建人', async () => {
  const db = await h.newDB();
  const { owner, ev, c1 } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true, add: true, edit: true, del: true, export: true },
  });
  const rec = await core.receive.createRecord(db, member, owner, ev, {
    contactId: c1, amount: 66600, type: '微信', date: '2026-10-18',
  });
  const inv = await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev] } });
  await core.share.accept(db, member, inv.membershipId);
  await core.share.removeMember(db, owner, inv.membershipId);
  const kept = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: rec._id });
  assert(kept, '记录应保留');
  assert.eq(kept.createdBy, member, 'createdBy 保留"谁加的"');
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert.eq(ms.status, 'removed', '成员状态为已移除');
});

// —— 成员视角事件：主人全量 / 成员只授权 / 无权限拒绝 ——
test('阶段3：成员视角只看授权事件', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const ev2 = await core.receive.createEvent(db, owner, owner, { name: '李四的婚宴', tagId: 'jiehun', date: '2026-10-02' });
  const { member } = await h.setupMember(db, owner, { events: [ev], switches: { view: true } });
  const mine = await core.stats.memberEvents(db, owner, owner);
  assert(mine.length === 2, '主人看全部事件');
  const theirs = await core.stats.memberEvents(db, member, owner);
  assert(theirs.length === 1 && theirs[0]._id === ev, '成员只看授权事件');
  await assertPermDenied(core.stats.memberEvents(db, '陌生人', owner), '陌生人看事件');
});

// —— 注销：账本清空、审计脱敏保留 ——
test('阶段3：注销清空账本数据，审计只留脱敏流水', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev] } });
  await core.export.exportData(db, owner, owner, {});
  const r = await core.account.purgeUserOnCancellation(db, owner);
  assert((r.deleted[COLLECTIONS.Contact] || 0) > 0, '联系人应被删除');
  assert((r.deleted[COLLECTIONS.ReceiveEvent] || 0) > 0, '礼薄应被删除');
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: owner }), 0, '账本清空');
  assert.eq(await db.collection(COLLECTIONS.GiftRecord).count({ ownerId: owner }), 0, '送礼清空');
  assert(r.auditKept > 0, '审计流水保留');
  const logs = await db.collection(COLLECTIONS.AuditLog).find({ ownerId: owner });
  for (const l of logs) {
    assert(!/\d{4,}/.test(String(l.detail || '')), '审计 detail 不含金额数字');
  }
});

// —— 到期提醒：三个时间点 ——
test('阶段3：会员到期三次提醒时间点', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'm1', { status: 'member', expireAt: Date.now() + 20 * 86400e3 });
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: owner });
  const times = core.quota.getReminderSchedule(user);
  assert.eq(times.length, 3, '三次提醒');
  assert(times[0] < user.membership.expireAt, '第一次在到期前');
  assert.eq(times[1], user.membership.expireAt, '第二次为到期当天');
  assert(times[2] > user.membership.expireAt, '第三次在到期后（缓冲期结束前）');
});
