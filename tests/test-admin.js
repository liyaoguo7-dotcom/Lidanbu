/**
* 老板平台"不返回账本内容"测试（阶段5骨架）
*
* 老板平台只看统计数字和会员状态。任何接口都不得返回用户的
* 礼金、联系人、备注内容，也不能替用户导出账本。
*
* 做法：造一批含特征字符串的账本数据（联系人姓名/备注、礼薄名、记录备注、
* 特征金额），用管理员身份调遍所有 admin 接口，把响应 JSON 序列化后断言
* 不包含这些特征串；同时断言数字字段存在且正确、白名单字段无多余。
*/
const { test, assert} = require('./fw');
const { newDB, newUser} = require('./helpers');
const core = require('../core');
const { COLLECTIONS} = core.models;
const admin = core.admin;

// 特征串：账本里独有，正常响应里绝不该出现
const NAME_MARK = '赵六_T3ST_甲';
const REMARK_MARK = '特征备注_T3ST_乙';
const EVENT_MARK = '婚宴_T3ST_丙';
const AMOUNT_FEN = 1234567; // → "12345.67"，断言两个形态都不出现
const MARKS = [NAME_MARK, REMARK_MARK, EVENT_MARK, String(AMOUNT_FEN), '12345.67'];

function assertNoLeak(obj, label) {
const s = JSON.stringify(obj);
for (const m of MARKS) {
assert(!s.includes(m), `${label} 泄露了账本内容特征串: ${m}`);
}
}

function assertKeys(obj, keys, label) {
const got = Object.keys(obj).sort().join(',');
const want = [...keys].sort().join(',');
assert(got === want, `${label} 字段白名单不符: 实际[${got}] 期望[${want}]`);
}

/** 造账本：ownerA(会员，含全部特征串) + ownerB(免费，普通数据) + 1个家人 + 2条邀请奖励 */
async function setupLedger(db) {
const ownerA = await newUser(db, 'ownerA_openid_001', {
status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null,
});
const ownerB = await newUser(db, 'ownerB_openid_002'); // free
// ownerA 的账本：姓名/备注/礼薄名/金额全部带特征串
const cA = await core.contacts.createContact(db, ownerA, ownerA, {
name: NAME_MARK, remark: REMARK_MARK,
});
const evA = await core.receive.createEvent(db, ownerA, ownerA, {
name: EVENT_MARK, tagId: 'jiehun', date: '2026-10-01',
});
await core.receive.createRecord(db, ownerA, ownerA, evA._id, {
contactId: cA._id, amount: AMOUNT_FEN, type: '现金',
remark: REMARK_MARK, date: '2026-10-01',
});
await core.gifts.createGift(db, ownerA, ownerA, {
contactId: cA._id, tagId: 'shengri', amount: AMOUNT_FEN,
remark: REMARK_MARK, date: '2026-09-01',
});
// ownerB 的普通账本（对照组：数字要能数对）
const cB = await core.contacts.createContact(db, ownerB, ownerB, { name: '王五'});
await core.gifts.createGift(db, ownerB, ownerB, {
contactId: cB._id, tagId: 'jiehun', amount: 20000, date: '2026-09-02',
});
// ownerA 邀请 1 位家人
const inv = await core.share.invite(db, ownerA, {
switches: { view: true}, scope: { events: [evA._id], gifts: false},
});
const member = await newUser(db, 'member_openid_003');
await core.share.accept(db, member, inv.membershipId);
// 邀请奖励发放记录（只存数量与时间）
await db.collection(COLLECTIONS.InviteRewardGrant).insert({
userId: ownerA, invitedUserId: 'newbie1', poolGranted: 10, giftsGranted: 5,
grantedAt: Date.now(),
});
await db.collection(COLLECTIONS.InviteRewardGrant).insert({
userId: ownerA, invitedUserId: 'newbie2', poolGranted: 10, giftsGranted: 5,
grantedAt: Date.now(),
});
return { ownerA, ownerB};
}

test('admin：数据概览只有条数，数字正确且无泄露', async () => {
const db = await newDB();
await setupLedger(db);
const r = await admin.overview(db);
assertKeys(r, ['userTotal', 'memberCount', 'freeCount', 'newUsersToday',
'receiveRecordTotal', 'giftRecordTotal', 'generatedAt'], 'overview');
assert.eq(r.userTotal, 3, '用户总数(2账本+1家人)');
assert.eq(r.memberCount, 1, '会员数');
assert.eq(r.freeCount, 2, '免费数');
assert.eq(r.receiveRecordTotal, 1, '收礼记录总数');
assert.eq(r.giftRecordTotal, 2, '送礼记录总数');
assertNoLeak(r, 'overview');
});

test('admin：会员列表字段白名单，userId 脱敏，数字正确且无泄露', async () => {
const db = await newDB();
const { ownerA} = await setupLedger(db);
const r = await admin.memberList(db, { page: 1, pageSize: 20});
assert.eq(r.total, 3, '总数');
assert.eq(r.items.length, 3, '本页条数');
for (const it of r.items) {
assertKeys(it, ['userId', 'memberState', 'expireAt', 'recordCounts'], 'memberList.item');
assertKeys(it.recordCounts, ['events', 'gifts', 'contacts'], 'recordCounts');
assert(it.userId.includes('***'), 'userId 必须脱敏');
assert(!it.userId.includes('ownerA_openid_001'), '不得出现原始 openid');
}
const aItem = r.items.find((i) => i.userId === admin.maskUserId(ownerA));
assert(aItem, '能找到 ownerA 的脱敏行');
assert.eq(aItem.memberState, 'member', 'ownerA 会员状态');
assert.eq(aItem.recordCounts.events, 1, 'ownerA 礼薄数');
assert.eq(aItem.recordCounts.gifts, 1, 'ownerA 送礼数');
assert.eq(aItem.recordCounts.contacts, 1, 'ownerA 亲友数');
// 按会员状态过滤
const members = await admin.memberList(db, { memberState: 'member'});
assert.eq(members.total, 1, 'member 过滤后总数');
assertNoLeak(r, 'memberList');
assertNoLeak(members, 'memberList(filter)');
});

test('admin：手动开通会员写操作记录，返回无泄露', async () => {
const db = await newDB();
const { ownerB} = await setupLedger(db);
const masked = admin.maskUserId(ownerB);
const before = Date.now();
const r = await admin.setMemberPlan(db, 'admin-tester', masked, 'manual', 30);
assertKeys(r, ['userId', 'memberState', 'expireAt'], 'setMemberPlan');
assert.eq(r.userId, masked, '返回脱敏 id');
assert.eq(r.memberState, 'member', '开通后为会员');
assert(r.expireAt > before + 29 * 86400e3, 'expireAt 约为30天后');
// 操作记录已写，且不含账本内容
const logs = await db.collection(COLLECTIONS.AuditLog).find({ ownerId: ownerB, action: 'grant' });
assert.eq(logs.length, 1, '写了一条 grant 操作记录');
assert.eq(logs[0].targetType, 'member', '对象为 member');
assert.eq(logs[0].detail, '老板手动开通会员30天', '摘要只写天数');
assertNoLeak(logs[0], 'audit log');
assertNoLeak(r, 'setMemberPlan');
// 非法参数拒绝
let threw = 0;
try { await admin.setMemberPlan(db, 'admin-tester', masked, 'yearvip', 30);} catch (e) { threw++;}
try { await admin.setMemberPlan(db, 'admin-tester', masked, 'manual', 0);} catch (e) { threw++;}
try { await admin.setMemberPlan(db, 'admin-tester', 'no***such', 'manual', 30);} catch (e) { threw++;}
assert.eq(threw, 3, '未知档位/非法天数/未知用户都被拒绝');
});

test('admin：额度使用只看数量与剩余，无金额无泄露', async () => {
const db = await newDB();
const { ownerA} = await setupLedger(db);
const r = await admin.quotaUsage(db, admin.maskUserId(ownerA));
assertKeys(r, ['userId', 'memberState', 'usage'], 'quotaUsage');
const kinds = r.usage.map((u) => u.kind).sort().join(',');
assert.eq(kinds, 'contacts,giftRecords,receiveEvents,receivePool', '四种额度齐全');
for (const u of r.usage) {
assertKeys(u, ['kind', 'used', 'limit', 'remain'], 'usage row');
assert.eq(u.remain, Math.max(0, u.limit - u.used), `${u.kind} remain=limit-used`);
}
const gifts = r.usage.find((u) => u.kind === 'giftRecords');
assert.eq(gifts.used, 1, '送礼已用1条');
const contacts = r.usage.find((u) => u.kind === 'contacts');
assert.eq(contacts.used, 1, '亲友已用1人');
assertNoLeak(r, 'quotaUsage');
});

test('admin：邀请奖励只看数量，无泄露', async () => {
const db = await newDB();
await setupLedger(db);
const r = await admin.inviteStats(db);
assertKeys(r, ['inviterCount', 'totalInvites', 'totalPoolGranted', 'totalGiftsGranted'], 'inviteStats');
assert.eq(r.inviterCount, 1, '邀请人数');
assert.eq(r.totalInvites, 2, '发放笔数');
assert.eq(r.totalPoolGranted, 20, '发放收礼池总数');
assert.eq(r.totalGiftsGranted, 10, '发放送礼数总数');
assertNoLeak(r, 'inviteStats');
});

test('admin：家庭共享概况只看每人几位家人，无泄露', async () => {
const db = await newDB();
const { ownerA} = await setupLedger(db);
const r = await admin.shareOverview(db);
assertKeys(r, ['ownerCount', 'totalMemberships', 'activeMemberships', 'perOwner'], 'shareOverview');
assert.eq(r.ownerCount, 1, '有家人的账本数');
assert.eq(r.activeMemberships, 1, '生效成员数');
assert.eq(r.perOwner.length, 1, 'perOwner 行数');
assertKeys(r.perOwner[0], ['ownerId', 'memberCount'], 'perOwner row');
assert.eq(r.perOwner[0].ownerId, admin.maskUserId(ownerA), 'ownerId 脱敏');
assert.eq(r.perOwner[0].memberCount, 1, 'ownerA 邀请了1位家人');
assertNoLeak(r, 'shareOverview');
});

test('admin：空账本不报错，返回零值且无泄露', async () => {
const db = await newDB();
const o = await admin.overview(db);
assert.eq(o.userTotal, 0, '空库用户数0');
assertNoLeak(o, 'overview(empty)');
const m = await admin.memberList(db);
assert.eq(m.total, 0, '空库列表0条');
const s = await admin.shareOverview(db);
assert.eq(s.ownerCount, 0, '空库共享0');
const iv = await admin.inviteStats(db);
assert.eq(iv.totalInvites, 0, '空库邀请0');
});
