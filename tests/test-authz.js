/** 权限矩阵测试（T1 验收核心） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

test('未授权用户读取拿不到数据', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  await h.newUser(db, 'stranger');
  let err = null;
  try { await core.receive.listRecords(db, 'stranger', owner, ev); } catch (e) { err = e; }
  assert(err, '陌生人读明细应抛错');
  const evs = await core.receive.listEvents(db, 'stranger', owner);
  assert.eq(evs.length, 0, '陌生人事件列表应为空');
});

test('未授权用户搜索拿不到数据', async () => {
  const db = await h.newDB();
  const { owner } = await h.setupOwner(db);
  await h.newUser(db, 'stranger');
  const res = await core.contacts.searchContacts(db, 'stranger', owner, '张');
  assert.eq(res.length, 0, '陌生人搜索应为空');
});

test('未授权用户统计拿不到数据', async () => {
  const db = await h.newDB();
  const { owner } = await h.setupOwner(db);
  await h.newUser(db, 'stranger');
  const st = await core.stats.getWanglaiStats(db, 'stranger', owner, { preset: 'lastYear' });
  assert.eq(st.receiveTotal, 0, '陌生人统计收礼应为0');
  assert.eq(st.giftTotal, 0, '陌生人统计送礼应为0');
});

test('撤销授权立即失效', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member, membershipId } = await h.setupMember(db, owner, { events: [ev], switches: { view: true } });
  let evs = await core.receive.listEvents(db, member, owner);
  assert.eq(evs.length, 1, '授权时应看到1个事件');
  await core.share.removeMember(db, owner, membershipId);
  evs = await core.receive.listEvents(db, member, owner);
  assert.eq(evs.length, 0, '移除后应立即看不到');
});

test('成员统计只含授权数据', async () => {
  const db = await h.newDB();
  const { owner, ev, c1 } = await h.setupOwner(db);
  // 再建一个事件+记录，不授权给成员
  const ev2 = await core.receive.createEvent(db, owner, owner, { name: '李四的生日宴', tagId: 'shengri', date: '2026-10-02' });
  await core.receive.createRecord(db, owner, owner, ev2._id, { contactId: c1, amount: 200000, type: '微信', date: '2026-10-02' });
  const { member } = await h.setupMember(db, owner, { events: [ev], switches: { view: true } });
  const st = await core.stats.getWanglaiStats(db, member, owner, { preset: 'lastYear' });
  assert.eq(st.receiveTotal, 100000, '成员只统计授权事件的100000分');
  assert.eq(st.receiveCount, 1, '成员只统计1笔');
});

test('成员无导出开关不能导出', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, { events: [ev], switches: { view: true } });
  const r = await core.authz.check(db, member, 'export', { kind: 'receiveRecord', ownerId: owner, eventId: ev });
  assert(!r.ok, '无导出开关应拒绝导出');
});

test('成员无删除开关不能删除', async () => {
  const db = await h.newDB();
  const { owner, ev, r1 } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, { events: [ev], switches: { view: true, add: true } });
  const r = await core.authz.check(db, member, 'delete', { kind: 'receiveRecord', ownerId: owner, eventId: ev });
  assert(!r.ok, '无删除开关应拒绝删除');
});

test('同名联系人互不混淆', async () => {
  const db = await h.newDB();
  const { owner } = await h.setupOwner(db);
  const a = await core.contacts.createContact(db, owner, owner, { name: '王五', remark: '同事' });
  const b = await core.contacts.createContact(db, owner, owner, { name: '王五', remark: '邻居' });
  assert(b.duplicateWarning, '第二个同名应有重名提醒');
  assert(a._id !== b._id, '同名联系人ID必须不同');
  const ev = await core.receive.createEvent(db, owner, owner, { name: '测试宴', tagId: 'qita', date: '2026-10-03' });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: a._id, amount: 10000, type: '现金', date: '2026-10-03' });
  const tl = await core.stats.getContactTimeline(db, owner, owner, b._id);
  assert.eq(tl.items.length, 0, '另一个同名联系人的时间线应为空');
});
