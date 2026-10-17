/** 往来统计与共享管理测试（T1.4 / T1.6） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

test('往来统计：总额笔数差额', async () => {
  const db = await h.newDB();
  const { owner } = await h.setupOwner(db);
  // setupOwner: 收礼 100000分×1笔，送礼 50000分×1笔
  const st = await core.stats.getWanglaiStats(db, owner, owner, { preset: 'lastYear' });
  assert.eq(st.receiveTotal, 100000, '收礼总额');
  assert.eq(st.giftTotal, 50000, '送礼总额');
  assert.eq(st.diff, 50000, '差额=收到-送出');
  assert.eq(st.isMember, false, '主人不显示成员提示');
});

test('时间范围过滤', async () => {
  const db = await h.newDB();
  const { owner } = await h.setupOwner(db);
  const st = await core.stats.getWanglaiStats(db, owner, owner, {
    preset: 'custom', from: '2026-09-01', to: '2026-09-30',
  });
  assert.eq(st.receiveTotal, 0, '9月无收礼');
  assert.eq(st.giftTotal, 50000, '9月有送礼50000分');
});

test('个人时间线最早在上', async () => {
  const db = await h.newDB();
  const { owner, c1 } = await h.setupOwner(db);
  // 给 c1 再加一条更早的送礼
  await core.gifts.createGift(db, owner, owner, { contactId: c1, tagId: 'qita', amount: 20000, date: '2025-01-01' });
  const tl = await core.stats.getContactTimeline(db, owner, owner, c1);
  assert(tl.items.length >= 2, '应有多条');
  assert(tl.items[0].date <= tl.items[1].date, '最早在上');
  assert.eq(tl.items[0].direction, 'out', '最早的是送出');
});

test('邀请需至少勾选一个范围', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1');
  let err = null;
  try {
    await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [], gifts: false } });
  } catch (e) { err = e; }
  assert(err, '无范围应拒绝发出邀请');
});

test('仅查看不可取消', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1');
  let err = null;
  try {
    await core.share.invite(db, owner, { switches: { view: false }, scope: { gifts: true } });
  } catch (e) { err = e; }
  assert(err, '取消仅查看应被拒绝');
});

test('修改权限立即生效', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member, membershipId } = await h.setupMember(db, owner, {
    events: [ev], switches: { view: true, add: true },
  });
  const c1 = (await core.contacts.listContacts(db, owner, owner))[0]._id;
  // 有 add 时可新增
  await core.receive.createRecord(db, member, owner, ev, { contactId: c1, amount: 1000, type: '现金', date: '2026-10-02' });
  // 关掉 add，立即生效
  await core.share.updateGrant(db, owner, membershipId, { switches: { view: true } });
  let err = null;
  try {
    await core.receive.createRecord(db, member, owner, ev, { contactId: c1, amount: 1000, type: '现金', date: '2026-10-02' });
  } catch (e) { err = e; }
  assert(err, '关闭add后应立即拒绝新增');
});
