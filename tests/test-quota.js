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

test('每礼薄50条额度（2026-10-24 用户改定 30→50）', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1');
  const c = await core.contacts.createContact(db, owner, owner, { name: '甲' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '宴', tagId: 'qita', date: '2026-10-01' });
  for (let i = 0; i < 50; i++) {
    await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  }
  let err = null;
  try {
    await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  } catch (e) { err = e; }
  assert(err && err.code && err.code.startsWith('quota-exceeded'), '第51条应被拦截，code=' + (err && err.code));
  const cntAfter = await db.collection(core.models.COLLECTIONS.ReceiveRecord).count({ ownerId: owner, eventId: ev._id });
  assert.eq(cntAfter, 50, '拒绝后数据未变：仍为50条');
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

test('会员额度新口径：有效会员取安全上限（不设业务额度）', async () => {
  const cfg = core.config;
  const member = {
    _id: 'u', membership: { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null },
  };
  const q = core.quota.getEffectiveQuota(member);
  assert.eq(q.receiveEvents, cfg.safetyCaps.books, '礼薄数=安全上限');
  assert.eq(q.recordsPerEvent, cfg.safetyCaps.perBook, '每薄笔数=安全上限（一本 5000 笔）');
  assert.eq(q.giftRecords, cfg.safetyCaps.giftRecords, '送礼=安全上限');
  assert.eq(q.contacts, cfg.safetyCaps.contacts, '亲友=安全上限');
});

test('邀请奖励额度与会员额度的叠加：免费叠池、会员封顶、到期回落免费+池', async () => {
  const cfg = core.config;
  const nowTs = Date.now();
  const opts = { successfulInvites: 2 }; // 2 次成功邀请：池 +20、送礼 +10
  const freeUser = { _id: 'u', membership: { status: 'free', expireAt: null, graceUntil: null } };
  const free = core.quota.getEffectiveQuota(freeUser, cfg, nowTs, opts);
  assert.eq(free.receiveEvents, 3, '免费：礼薄仍为 3（邀请不增礼薄数）');
  assert.eq(free.recordsPerEvent, 50, '免费：每薄 50（2026-10-24 用户改定 30→50）');
  assert.eq(free.receivePool, 20, '免费：邀请池生效 +20');
  assert.eq(free.giftRecords, 60, '免费：送礼 50+10');
  assert.eq(free.contacts, 50, '免费：亲友仍为 50');
  const memberUser = { _id: 'u', membership: { status: 'member', expireAt: nowTs + 30 * 86400e3, graceUntil: null } };
  const mem = core.quota.getEffectiveQuota(memberUser, cfg, nowTs, opts);
  assert.eq(mem.receiveEvents, cfg.safetyCaps.books, '会员：礼薄封顶安全上限');
  assert.eq(mem.recordsPerEvent, cfg.safetyCaps.perBook, '会员：每薄封顶安全上限');
  assert.eq(mem.giftRecords, cfg.safetyCaps.giftRecords, '会员：送礼封顶安全上限');
  assert.eq(mem.contacts, cfg.safetyCaps.contacts, '会员：亲友封顶安全上限');
  assert.eq(mem.receivePool, 20, '会员：邀请池保留叠加口径');
  const expiredUser = { _id: 'u', membership: { status: 'member', expireAt: nowTs - 40 * 86400e3, graceUntil: null } };
  assert.eq(core.quota.getMembershipState(expiredUser, cfg, nowTs), 'expired', '前提：已过缓冲期');
  const back = core.quota.getEffectiveQuota(expiredUser, cfg, nowTs, opts);
  assert.eq(back.receiveEvents, 3, '到期回落：礼薄回到免费 3');
  assert.eq(back.giftRecords, 60, '到期回落：送礼回到免费+池');
  assert.eq(back.receivePool, 20, '到期回落：邀请池继续生效');
});

test('导出：免费用户可导出自己全部数据（导出对所有用户免费，无会员门禁）', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free_exporter'); // 免费用户
  const c = await core.contacts.createContact(db, owner, owner, { name: '甲' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '宴', tagId: 'qita', date: '2026-10-01' });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  await core.gifts.createGift(db, owner, owner, { contactId: c._id, tagId: 'shengri', amount: 200, date: '2026-09-01' });
  const sc = await core.export.checkExportScope(db, owner, owner);
  assert(sc.ok && sc.reason === 'owner', '本人导出范围应放行');
  const data = await core.export.exportData(db, owner, owner);
  assert.eq(data.events.length, 1, '免费用户可导出礼薄');
  assert.eq(data.records.length, 1, '免费用户可导出收礼记录');
  assert.eq(data.gifts.length, 1, '免费用户可导出送礼记录');
});

test('无成功邀请时邀请奖励额度为0', async () => {
  const q = core.quota.getInviteRewardQuota('anyone');
  assert.eq(q.receiveEvents, 0, '邀请奖励不增加礼薄个数');
  assert.eq(q.contacts, 0, '邀请奖励不增加联系人额度');
  const user = { _id: 'u', membership: { status: 'free' } };
  const eff = core.quota.getEffectiveQuota(user);
  assert.eq(eff.receiveEvents, 3, '免费用户有效额度=免费3+会员0+邀请0');
});
