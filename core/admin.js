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
const errors = require('./errors');
const { maskUserId } = require('./admin-mask');
const StaticConfig = require('../miniprogram/config/app-config');

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
const successfulInvites = await quota.countSuccessfulInvites(db, user._id);
const inviteSettings = await quota.resolveInviteSettings(db);
const q = quota.getEffectiveQuota(user, StaticConfig, Date.now(), { successfulInvites, settings: inviteSettings });
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

// ================= 配置管理（阶段5第5/13项：额度与价格设置、会员专属清单） =================
//
// 配置真源：云数据库 appConfig 集合的 singleton 文档
// {_id:'singleton', adminIds:[openid...], freeQuota?, memberQuota?,
// membershipFeatures?, memberOnlyFeatures?, pricing?, updatedAt}，
// 与 models.js 的 AppConfig 字典一致；未写过的段回退静态配置默认值。
// 管理员名单只认该文档的 adminIds：文档不存在或名单为空时一律拒绝
// （fail closed）；首位管理员需直接在云数据库写入该文档。
// 每次修改都写 AuditLog（action:'config'），detail 只写段名与条数摘要。
// 注意：quota.js 当前读静态配置；云联调时改为先读本配置文档再注入
// quota 函数的 config 参数（已支持注入），本节写入即刻落库并留审计。

const CONFIG_DOC_ID = 'singleton';
const KNOWN_MEMBER_ONLY_FEATURES = ['familyShareInvite', 'photoImport', 'landscapeMode'];
const KNOWN_FEATURE_SWITCHES = ['photoImport', 'redLedgerMode'];
const QUOTA_KEYS = ['receiveEvents', 'recordsPerEvent', 'giftRecords', 'contacts'];

function badConfig(msg) {
const e = new Error(`配置不合法：${msg}`);
e.code = 'bad-config';
return e;
}

async function readConfigDoc(db) {
return db.collection(COLLECTIONS.AppConfig).findOne({ _id: CONFIG_DOC_ID});
}

/** 是否管理员：只认 appConfig 文档 adminIds 名单（无名单=无人是管理员） */
async function isAdmin(db, actorId) {
if (!actorId) return false;
const doc = await readConfigDoc(db);
return !!(doc && Array.isArray(doc.adminIds) && doc.adminIds.includes(actorId));
}

async function requireAdmin(db, actorId) {
if (!(await isAdmin(db, actorId))) throw errors.permDenied('not-admin');
}

/**
* 读取生效配置（仅管理员）：db 文档覆盖静态默认，只返回白名单段
* @returns {{freeQuota, memberQuota, membershipFeatures, memberOnlyFeatures, inviteReward, pricing, updatedAt}}
*/
async function getConfig(db, actorId) {
await requireAdmin(db, actorId);
const doc = (await readConfigDoc(db)) || {};
return {
freeQuota: { ...StaticConfig.freeQuota, ...(doc.freeQuota || {})},
memberQuota: { ...StaticConfig.membership.quota, ...(doc.memberQuota || {})},
membershipFeatures: { ...StaticConfig.membership.features, ...(doc.membershipFeatures || {})},
memberOnlyFeatures: doc.memberOnlyFeatures || [...StaticConfig.memberOnlyFeatures],
inviteReward: await quota.resolveInviteSettings(db),
pricing: doc.pricing || [],
updatedAt: doc.updatedAt || null,
};
}

/** 内部：整段写入配置（patch 为 段名→值）+ 审计，返回 updatedAt */
async function writeConfigPatch(db, actorId, patch, detail) {
const updatedAt = now();
const doc = await readConfigDoc(db);
if (doc) {
await db.collection(COLLECTIONS.AppConfig).update({ _id: CONFIG_DOC_ID}, { ...patch, updatedAt});
} else {
await db.collection(COLLECTIONS.AppConfig).insert({ _id: CONFIG_DOC_ID, ...patch, updatedAt});
}
await audit.log(db, {
ownerId: actorId, actorId, action: 'config', targetType: 'config',
targetId: Object.keys(patch).join(','), detail,
});
return updatedAt;
}

/**
* 修改会员价格档位（仅管理员）
* plans: [{id, name, priceFen(分), days}]，最多10个，id 唯一；
* 空数组表示清空（回到"价格待定"占位）。价格数字本身待用户定价，
* 本接口只负责落库+校验+审计，不内置任何价格。
*/
async function updatePricing(db, actorId, plans) {
await requireAdmin(db, actorId);
if (!Array.isArray(plans) || plans.length > 10) throw badConfig('价格档位必须是数组（最多10个）');
const seen = new Set();
const clean = plans.map((p) => {
if (!p || typeof p!== 'object') throw badConfig('档位格式不对');
const id = String(p.id || '');
if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw badConfig(`档位id不合法:${id}`);
if (seen.has(id)) throw badConfig(`档位id重复:${id}`);
seen.add(id);
const name = String(p.name || '').trim();
if (!name || name.length > 20) throw badConfig('档位名称不能为空且不超过20字');
if (!Number.isInteger(p.priceFen) || p.priceFen < 0 || p.priceFen > 100000000) {
throw badConfig('价格（分）必须为0~100000000的整数');
}
if (!Number.isInteger(p.days) || p.days < 1 || p.days > 3650) {
throw badConfig('天数必须为1~3650的整数');
}
return { id, name, priceFen: p.priceFen, days: p.days};
});
const updatedAt = await writeConfigPatch(db, actorId, { pricing: clean}, `修改会员价格档位：共${clean.length}个档位`);
return { pricing: clean, updatedAt};
}

/**
* 修改会员功能开关（仅管理员）：键只允许 photoImport / redLedgerMode，
* 值必须为布尔；未传的键保持原值（与静态默认合并后整段落库）。
*/
async function updateFeatureSwitches(db, actorId, features) {
await requireAdmin(db, actorId);
if (!features || typeof features!== 'object' || Array.isArray(features)) throw badConfig('功能开关必须是对象');
const keys = Object.keys(features);
if (keys.length === 0) throw badConfig('功能开关不能为空');
for (const k of keys) {
if (!KNOWN_FEATURE_SWITCHES.includes(k)) throw badConfig(`未知功能开关:${k}`);
if (typeof features[k]!== 'boolean') throw badConfig(`功能开关${k}必须为开/关`);
}
const doc = (await readConfigDoc(db)) || {};
const merged = { ...StaticConfig.membership.features, ...(doc.membershipFeatures || {}), ...features};
const updatedAt = await writeConfigPatch(db, actorId, { membershipFeatures: merged}, `修改功能开关：${keys.join('、')}`);
return { membershipFeatures: merged, updatedAt};
}

/**
* 修改会员专属功能清单（仅管理员）：只允许已知功能名
* （familyShareInvite / photoImport / landscapeMode），quota 的会员门禁读此清单。
*/
async function updateMemberOnlyFeatures(db, actorId, features) {
await requireAdmin(db, actorId);
if (!Array.isArray(features)) throw badConfig('会员专属功能清单必须是数组');
const clean = [...new Set(features.map((f) => String(f)))];
for (const f of clean) {
if (!KNOWN_MEMBER_ONLY_FEATURES.includes(f)) throw badConfig(`未知会员专属功能:${f}`);
}
const updatedAt = await writeConfigPatch(db, actorId, { memberOnlyFeatures: clean}, `修改会员专属功能清单：共${clean.length}项`);
return { memberOnlyFeatures: clean, updatedAt};
}

function checkQuotaPatch(patch, label) {
if (!patch || typeof patch!== 'object' || Array.isArray(patch)) throw badConfig(`${label}必须是对象`);
const keys = Object.keys(patch);
if (keys.length === 0) throw badConfig(`${label}不能为空`);
for (const k of keys) {
if (!QUOTA_KEYS.includes(k)) throw badConfig(`${label}含未知项:${k}`);
const v = patch[k];
if (!Number.isInteger(v) || v < 0 || v > 1000000) throw badConfig(`${label}.${k}必须为0~1000000的整数`);
}
}

/**
* 修改额度设置（仅管理员）：freeQuota / memberQuota 至少给一个，
* 按项合并（未传的项保持原值）。数字校验后落库并审计。
*/
async function updateQuotaSettings(db, actorId, { freeQuota, memberQuota} = {}) {
await requireAdmin(db, actorId);
if (freeQuota === undefined && memberQuota === undefined) throw badConfig('没有要修改的额度设置');
const doc = (await readConfigDoc(db)) || {};
const patch = {};
if (freeQuota!== undefined) {
checkQuotaPatch(freeQuota, '免费额度');
patch.freeQuota = { ...StaticConfig.freeQuota, ...(doc.freeQuota || {}), ...freeQuota};
}
if (memberQuota!== undefined) {
checkQuotaPatch(memberQuota, '会员额度');
patch.memberQuota = { ...StaticConfig.membership.quota, ...(doc.memberQuota || {}), ...memberQuota};
}
const changed = [freeQuota!== undefined && '免费额度', memberQuota!== undefined && '会员额度'].filter(Boolean).join('、');
const updatedAt = await writeConfigPatch(db, actorId, patch, `修改额度设置：${changed}`);
const cfg = await getConfig(db, actorId);
return { freeQuota: cfg.freeQuota, memberQuota: cfg.memberQuota, updatedAt};
}

/**
* 修改邀请奖励设置（仅管理员）：enabled / perInvite / maxSuccessfulInvites
* 至少给一项，按项合并（未传的项保持生效值）。maxSuccessfulInvites 的
* 含义 = 每个邀请人最多计入的成功邀请次数（默认 10，含义待用户最终确认）；
* 改动对之后的发放与额度计算立即生效（发放记录为真源，历史发放不追溯）。
*/
async function updateInviteSettings(db, actorId, { enabled, perInvite, maxSuccessfulInvites } = {}) {
await requireAdmin(db, actorId);
if (enabled === undefined && perInvite === undefined && maxSuccessfulInvites === undefined) {
throw badConfig('没有要修改的邀请奖励设置');
}
const current = await quota.resolveInviteSettings(db);
const next = {
enabled: current.enabled,
perInvite: { ...current.perInvite },
maxSuccessfulInvites: current.maxSuccessfulInvites,
};
const changed = [];
if (enabled!== undefined) {
if (typeof enabled!== 'boolean') throw badConfig('邀请奖励开关必须为开/关');
next.enabled = enabled;
changed.push('开关');
}
if (perInvite!== undefined) {
if (!perInvite || typeof perInvite!== 'object' || Array.isArray(perInvite)) throw badConfig('每邀请奖励必须是对象');
for (const k of Object.keys(perInvite)) {
if (!['receivePool', 'giftRecords'].includes(k)) throw badConfig(`每邀请奖励含未知项:${k}`);
const v = perInvite[k];
if (!Number.isInteger(v) || v < 0 || v > 100000) throw badConfig(`每邀请奖励.${k}必须为0~100000的整数`);
next.perInvite[k] = v;
}
changed.push('每邀请奖励');
}
if (maxSuccessfulInvites!== undefined) {
if (!Number.isInteger(maxSuccessfulInvites) || maxSuccessfulInvites < 0 || maxSuccessfulInvites > 10000) {
throw badConfig('成功邀请上限必须为0~10000的整数');
}
next.maxSuccessfulInvites = maxSuccessfulInvites;
changed.push('成功邀请上限');
}
const updatedAt = await writeConfigPatch(db, actorId, { inviteReward: next }, `修改邀请奖励设置：${changed.join('、')}`);
return { inviteReward: next, updatedAt };
}

module.exports = {
maskUserId,
overview,
memberList,
setMemberPlan,
quotaUsage,
inviteStats,
shareOverview,
isAdmin,
getConfig,
updatePricing,
updateFeatureSwitches,
updateMemberOnlyFeatures,
updateQuotaSettings,
updateInviteSettings,
};
