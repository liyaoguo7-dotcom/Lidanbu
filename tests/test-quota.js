/** 额度与会员到期测试（T1.5） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

test('免费额度用完拦截新增，旧记录不删', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1');
  // 免费额度 3 个礼薄：建满 3 个
  for (let i = 0; i < 3; i++) {
    await core.receive.createEvent(db, owner, owner, { name: `宴${i}`, tagId: 'qita', date: '2026-10-01' });
  }
  let err = null;
  try {
    await core.receive.createEvent(db, owner, owner, { name: '第4个宴', tagId: 'qita', date: '2026-10-01' });
  } catch (e) { err = e; }
  assert(err && err.code && err.code.startsWith('quota-exceeded'), '第4个应被额度拦截，code=' + (err && err.code));
  const evs = await core.receive.listEvents(db, owner, owner);
  assert.eq(evs.length, 3, '旧记录一条不删，应仍为3个');
});

test('每礼薄30条额度', async () => {
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
  assert(err && err.code && err.code.startsWith('quota-exceeded'), '第31条应被拦截，code=' + (err && err.code));
  const cntAfter = await db.collection(core.models.COLLECTIONS.ReceiveRecord).count({ ownerId: owner, eventId: ev._id });
  assert.eq(cntAfter, 30, '拒绝后数据未变：仍为30条');
});

test('会员有效期内额度扩大', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1', {
    status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null,
  });
  const user = await db.collection(core.models.COLLECTIONS.User).findOne({ _id: owner });
  const q = core.quota.getEffectiveQuota(user);
  assert(q.receiveEvents > 3, '会员礼薄额度应大于免费3个');
  // 会员可建第4个
  for (let i = 0; i < 4; i++) {
    await core.receive.createEvent(db, owner, owner, { name: `宴${i}`, tagId: 'qita', date: '2026-10-01' });
  }
  const evs = await core.receive.listEvents(db, owner, owner);
  assert.eq(evs.length, 4, '会员应能建4个礼薄');
});

test('会员到期后超额记录只读', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1', {
    status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null,
  });
  // 会员期内建 4 个礼薄（第4个超出免费额度）
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = await core.receive.createEvent(db, owner, owner, { name: `宴${i}`, tagId: 'qita', date: '2026-10-01' });
    ids.push(r._id);
  }
  // 会员到期（expireAt 设为过去）
  await db.collection(core.models.COLLECTIONS.User).update(
    { _id: owner },
    { membership: { status: 'member', expireAt: Date.now() - 1000, graceUntil: null } }
  );
  const user = await db.collection(core.models.COLLECTIONS.User).findOne({ _id: owner });
  assert.eq(core.quota.getMembershipState(user), 'grace', '刚过期应在缓冲期');
  // 第4个（超额）不可改
  let err = null;
  try {
    await core.receive.updateEvent(db, owner, owner, ids[3], { remark: '改' });
  } catch (e) { err = e; }
  assert(err && err.code && err.code.startsWith('readonly'), '超额记录到期后应只读，code=' + (err && err.code));
  // 前3个（免费额度内）仍可改
  await core.receive.updateEvent(db, owner, owner, ids[0], { remark: '改' });
  const e0 = await db.collection(core.models.COLLECTIONS.ReceiveEvent).findOne({ _id: ids[0] });
  assert.eq(e0.remark, '改', '免费额度内记录仍可改');
});

test('三次提醒时间点', async () => {
  const expireAt = Date.now() + 30 * 86400e3;
  const user = { _id: 'u', membership: { status: 'member', expireAt } };
  const pts = core.quota.getReminderSchedule(user);
  assert.eq(pts.length, 3, '应有3个提醒点');
  assert(pts[0] < pts[1] && pts[1] < pts[2], '提醒点应递增');
  assert.eq(pts[1], expireAt, '第2个应为到期当天');
});

test('无成功邀请时邀请奖励额度为0', async () => {
  const q = core.quota.getInviteRewardQuota('anyone');
  assert.eq(q.receiveEvents, 0, '邀请奖励不增加礼薄个数');
  assert.eq(q.contacts, 0, '邀请奖励不增加联系人额度');
  const user = { _id: 'u', membership: { status: 'free' } };
  const eff = core.quota.getEffectiveQuota(user);
  assert.eq(eff.receiveEvents, 3, '免费用户有效额度=免费3+会员0+邀请0');
});
