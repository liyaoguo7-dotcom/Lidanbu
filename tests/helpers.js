/** 测试辅助：建用户/联系人/事件等 */
const core = require('../core');
const { COLLECTIONS } = core.models;

async function newDB() {
  return new core.db.MemoryDB();
}

async function newUser(db, openid, membership) {
  await db.collection(COLLECTIONS.User).insert({
    _id: openid,
    membership: membership || { status: 'free', expireAt: null, graceUntil: null },
    createdAt: Date.now(),
  });
  return openid;
}

async function setupOwner(db) {
  const owner = await newUser(db, 'owner1');
  const c1 = await core.contacts.createContact(db, owner, owner, { name: '张三', remark: '同学' });
  const c2 = await core.contacts.createContact(db, owner, owner, { name: '李四' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '张三的婚宴', tagId: 'jiehun', date: '2026-10-01' });
  const r1 = await core.receive.createRecord(db, owner, owner, ev._id, {
    contactId: c1._id, amount: 100000, type: '现金', date: '2026-10-01',
  });
  const g1 = await core.gifts.createGift(db, owner, owner, {
    contactId: c2._id, tagId: 'shengri', amount: 50000, date: '2026-09-01',
  });
  return { owner, c1: c1._id, c2: c2._id, ev: ev._id, r1: r1._id, g1: g1._id };
}

/** 建一个只有"查看部分事件"的成员 */
async function setupMember(db, owner, { events = [], gifts = false, switches } = {}) {
  const member = await newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, {
    switches: switches || { view: true },
    scope: { events, gifts },
  });
  await core.share.accept(db, inv.membershipId, member);
  return { member, membershipId: inv.membershipId };
}

module.exports = { newDB, newUser, setupOwner, setupMember };
