/** CRUD 与删除影响条数测试（T1.3） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

test('删除联系人先返回影响条数', async () => {
  const db = await h.newDB();
  const { owner, c1 } = await h.setupOwner(db);
  // setupOwner: c1 有 1 条收礼；再给 c1 加 1 条送礼
  await core.gifts.createGift(db, owner, owner, { contactId: c1, tagId: 'qita', amount: 10000, date: '2026-10-01' });
  const pre = await core.contacts.deleteContact(db, owner, owner, c1, false);
  assert.eq(pre.confirmed, false, '未确认时不删除');
  assert.eq(pre.receiveCount, 1, '应返回1条收礼');
  assert.eq(pre.giftCount, 1, '应返回1条送礼');
  // 确认删除：连带永久删除
  const done = await core.contacts.deleteContact(db, owner, owner, c1, true);
  assert.eq(done.confirmed, true, '确认后执行删除');
  const cts = await core.contacts.listContacts(db, owner, owner);
  assert(!cts.find((c) => c._id === c1), '联系人已删除');
  const rs = await db.collection(core.models.COLLECTIONS.ReceiveRecord).find({ contactId: c1 });
  const gs = await db.collection(core.models.COLLECTIONS.GiftRecord).find({ contactId: c1 });
  assert.eq(rs.length, 0, '其收礼记录连带删除');
  assert.eq(gs.length, 0, '其送礼记录连带删除');
  // 审计留痕
  const logs = await core.audit.list(db, owner);
  assert(logs.some((l) => l.action === 'delete' && l.targetType === 'contact'), '删除应留审计');
});

test('礼薄名称同一账本内查重', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1');
  await core.receive.createEvent(db, owner, owner, { name: '重名宴', tagId: 'qita', date: '2026-10-01' });
  let err = null;
  try {
    await core.receive.createEvent(db, owner, owner, { name: '重名宴', tagId: 'qita', date: '2026-10-02' });
  } catch (e) { err = e; }
  assert(err, '完全重名应被拦截');
});

test('成员可新增明细但不可新建礼薄', async () => {
  const db = await h.newDB();
  const { owner, ev, c1 } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true, add: true },
  });
  // 成员在授权事件内新增明细：允许
  await core.receive.createRecord(db, member, owner, ev, { contactId: c1, amount: 5000, type: '现金', date: '2026-10-02' });
  // 成员新建礼薄：拒绝
  let err = null;
  try {
    await core.receive.createEvent(db, member, owner, { name: '成员建的宴', tagId: 'qita', date: '2026-10-02' });
  } catch (e) { err = e; }
  assert(err, '成员新建礼薄应被拒绝');
});

test('移除成员后其新增记录保留并保留创建者', async () => {
  const db = await h.newDB();
  const { owner, ev, c1 } = await h.setupOwner(db);
  const { member, membershipId } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true, add: true },
  });
  const r = await core.receive.createRecord(db, member, owner, ev, { contactId: c1, amount: 5000, type: '现金', date: '2026-10-02' });
  await core.share.removeMember(db, owner, membershipId);
  const rec = await db.collection(core.models.COLLECTIONS.ReceiveRecord).findOne({ _id: r._id });
  assert(rec, '移除成员后记录应保留');
  assert.eq(rec.createdBy, member, '应保留创建者');
});

test('金额必须为正整数分', async () => {
  const db = await h.newDB();
  const { owner, ev, c1 } = await h.setupOwner(db);
  let err = null;
  try {
    await core.receive.createRecord(db, owner, owner, ev, { contactId: c1, amount: 10.5, type: '现金', date: '2026-10-01' });
  } catch (e) { err = e; }
  assert(err, '小数金额应被拒绝');
});
