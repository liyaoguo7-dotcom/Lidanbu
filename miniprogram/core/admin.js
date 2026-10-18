/**
* 礼单簿 · 老板平台聚合接口（阶段5 骨架）
*
* 老板平台只看统计数字和会员状态。
* 任何接口/页面/导出都不得返回用户的礼金、联系人、备注内容，
* 也不能替用户导出账本。
*
* 实现铁律（本文件内强制执行）：
* 1. 读账本集合（contacts/receiveEvents/receiveRecords/giftRecords）时只做
* count / 聚合，绝不把记录行返回给调用方；
* 2. 所有返回对象只含白名单字段，逐个字段手写构造，绝不 spread 数据库文档；
* 3. userId 一律脱敏短号对外展示，内部用 mask 解析回真实 id。
*
* 骨架范围：阶段5第1/2/12/14/15项的数字部分；其余项（反馈列表、订单收入、
* 功能开关等）后续再加，不要一次做完。
*/
const { COLLECTIONS, now} = require('./models');
const quota = require('./quota');
const audit = require('./audit');

/** userId 脱敏：前3 + *** + 后3，如 oAb***9zQ */
function maskUserId(openid) {
const s = String(openid || '');
if (s.length <= 8) return s.slice(0, 2) + '***';
return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

/** 内部：用脱敏短号找回真实用户（骨架实现：全表扫描比对；生产需建索引） */
async function findUserByMask(db, maskedId) {
const users = await db.collection(COLLECTIONS.User).find({});
const hits = users.filter((u) => maskUserId(u._id) === maskedId);
if (hits.length === 0) throw new Error('admin:user-not-found');
if (hits.length > 1) throw new Error('admin:mask-collision');
return hits[0];
}

/** 内部：只做计数的快捷方式（禁止在这里 find 记录行） */
function countCol(db, name, query) {
return db.collection(COLLECTIONS[name]).count(query || {});
}

/** 当天 0 点时间戳（本地时区） */
function dayStart(ts = Date.now()) {
const d = new Date(ts);
d.setHours(0, 0, 0, 0);
return d.getTime();
}

/**
* 数据概览（阶段5第1项）：只有条数，无金额无名单
* @returns {{userTotal, memberCount, freeCount, newUsersToday,
* receiveRecordTotal, giftRecordTotal, generatedAt}}
*/
async function overview(db) {
const users = await db.collection(COLLECTIONS.User).find({});
let memberCount = 0;
let newUsersToday = 0;
const start = dayStart();
for (const u of users) {
if (quota.getMembershipState(u) === 'member') memberCount += 1;
if ((u.createdAt || 0) >= start) newUsersToday += 1;
}
const receiveRecordTotal = await countCol(db, 'ReceiveRecord');
const giftRecordTotal = await countCol(db, 'GiftRecord');
return {
userTotal: users.length,
memberCount,
freeCount: users.length - memberCount,
newUsersToday,
receiveRecordTotal,
giftRecordTotal,
generatedAt: now(),
};
}

/**
* 会员管理列表（阶段5第2项）：分页，每条只有白名单字段
* @returns {{total, page, pageSize, items: [{userId, memberState, expireAt,
* recordCounts: {events, gifts, contacts}}]}}
*/
async function memberList(db, { page = 1, pageSize = 20, memberState} = {}) {
const users = await db.collection(COLLECTIONS.User).find({}, { sort: { createdAt: -1}});
const filtered = memberState
? users.filter((u) => quota.getMembershipState(u) === memberState)
: users;
const total = filtered.length;
const p = Math.max(1, page | 0);
const ps = Math.min(100, Math.max(1, pageSize | 0));
const items = [];
for (const u of filtered.slice((p - 1) * ps, p * ps)) {
const st = quota.getMembershipState(u);
items.push({
userId: maskUserId(u._id),
memberState: st, // free | member | grace | expired
expireAt: (u.membership && u.membership.expireAt) || null,
recordCounts: {
events: await countCol(db, 'ReceiveEvent', { ownerId: u._id}),
gifts: await countCol(db, 'GiftRecord', { ownerId: u._id}),
contacts: await countCol(db, 'Contact', { ownerId: u._id}),
},
});
}
return { total, page: p, pageSize: ps, items};
}

/**
* 手动开通/延期会员（阶段5第2项）：写操作记录到 audit
* @param {string} maskedUserId 脱敏短号
* @param {string} plan 目前只支持 'manual'（价格档位待定）
* @param {number} days 天数，1~1095
* @returns {{userId, memberState, expireAt}}
*/
async function setMemberPlan(db, maskedUserId, plan, days, actorId = 'admin') {
if (plan!== 'manual') throw new Error('admin:unknown-plan');
const d = Number(days);
if (!Number.isInteger(d) || d < 1 || d > 1095) throw new Error('admin:bad-days');
const user = await findUserByMask(db, maskedUserId);
const base = Math.max(now(), (user.membership && user.membership.expireAt) || 0);
const expireAt = base + d * 86400e3;
await db.collection(COLLECTIONS.User).update(
{ _id: user._id},
{ membership: { status: 'member', expireAt, graceUntil: null}}
);
// 操作记录：只写"做了什么+天数"，不含任何账本内容
await audit.log(db, {
ownerId: user._id,
actorId,
action: 'grant',
targetType: 'member',
targetId: maskedUserId,
detail: `老板手动开通会员${d}天`,
});
return { userId: maskedUserId, memberState: 'member', expireAt};
}

/**
* 用户额度使用情况（阶段5第12项）：只看数量与剩余，无金额
* @returns {{userId, memberState, usage: [{kind, used, limit, remain}] kind:
* receiveEvents(礼薄数) | giftRecords(送礼条数) | contacts(亲友数) | receivePool(收礼额度池)}}
*/
async function quotaUsage(db, maskedUserId) {
const user = await findUserByMask(db, maskedUserId);
const q = quota.getEffectiveQuota(user);
const usedEvents = await countCol(db, 'ReceiveEvent', { ownerId: user._id});
const usedGifts = await countCol(db, 'GiftRecord', { ownerId: user._id});
const usedContacts = await countCol(db, 'Contact', { ownerId: user._id});
const poolUsed = await quota.computePoolUsed(db, user._id, q.recordsPerEvent);
const row = (kind, used, limit) => ({
kind, used, limit, remain: Math.max(0, limit - used),
});
return {
userId: maskedUserId,
memberState: quota.getMembershipState(user),
usage: [
row('receiveEvents', usedEvents, q.receiveEvents),
row('giftRecords', usedGifts, q.giftRecords),
row('contacts', usedContacts, q.contacts),
row('receivePool', poolUsed, q.receivePool || 0),
],
};
}

/**
* 邀请奖励数据（阶段5第14项）：只看数量
* @returns {{inviterCount, totalInvites, totalPoolGranted, totalGiftsGranted}}
*/
async function inviteStats(db) {
const grants = await db.collection(COLLECTIONS.InviteRewardGrant).find({});
const inviters = new Set(grants.map((g) => g.userId));
let totalPoolGranted = 0;
let totalGiftsGranted = 0;
for (const g of grants) {
totalPoolGranted += g.poolGranted || 0;
totalGiftsGranted += g.giftsGranted || 0;
}
return {
inviterCount: inviters.size,
totalInvites: grants.length,
totalPoolGranted,
totalGiftsGranted,
};
}

/**
* 家庭共享概况（阶段5第15项）：每人邀请了几位家人，只看数量
* @returns {{ownerCount, totalMemberships, activeMemberships, perOwner: [{ownerId, memberCount}] 每项 ownerId 为脱敏短号}}
*/
async function shareOverview(db, { limit = 200} = {}) {
const all = await db.collection(COLLECTIONS.ShareMembership).find({});
const byOwner = new Map();
let activeMemberships = 0;
for (const m of all) {
if (m.status === 'active') activeMemberships += 1;
if (m.status === 'removed') continue;
byOwner.set(m.ownerId, (byOwner.get(m.ownerId) || 0) + 1);
}
const perOwner = [...byOwner.entries()]
.map(([ownerId, memberCount]) => ({ ownerId: maskUserId(ownerId), memberCount}))
.sort((a, b) => b.memberCount - a.memberCount)
.slice(0, Math.max(1, limit | 0));
return {
ownerCount: byOwner.size,
totalMemberships: all.filter((m) => m.status!== 'removed').length,
activeMemberships,
perOwner,
};
}

module.exports = {
maskUserId,
overview,
memberList,
setMemberPlan,
quotaUsage,
inviteStats,
shareOverview,
};
