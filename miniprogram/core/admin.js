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
* 范围：15 项全部接真接口（任务M 补全第3/4/6/7/10/11项与配置写接口）。
* 新增接口一律 requireAdmin（生效名单 = adminIds ∪ addedAdminIds，见 isAdmin）。
* 管理员名单分两档（用户 2026-10-24 定）：adminIds 是云端后台（控制台）导入的
* 管理员，只有这一档可以增减管理员；addedAdminIds 是云端管理员在应用内
* 添加的管理员，能用老板平台但不能增减管理员。
*/
const { COLLECTIONS, now} = require('./models');
const quota = require('./quota');
const audit = require('./audit');
const errors = require('./errors');
const { maskUserId } = require('./admin-mask');
const feedback = require('./feedback');
const points = require('./points');
const StaticConfig = require('../config/app-config');

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
// 任务AD：第二参数 actorId 为 api 分发约定预留（分发统一以 (db, actorId, ...)
// 调用），本函数只做全站聚合、不按调用者过滤，参数暂不使用；本地旧调用
// overview(db) 不受影响。
async function overview(db, actorId) {
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
// 任务AD 签名对齐：新口径 (db, actorId, opts)（api 分发约定）；旧口径
// (db, opts) 双兼容——第二参为对象且第三参缺省时按旧口径解释，存量调用不改。
async function memberList(db, actorId, opts) {
  const { page = 1, pageSize = 20, memberState } = (opts === undefined && actorId && typeof actorId === 'object') ? actorId : (opts || {});
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
// 任务AD 签名对齐：(db, actorId, maskedUserId, plan, days)——与 api 分发约定
// 及本文件其余管理员接口统一；审计记录里的操作者沿用旧口径 'admin:<actorId>'。
async function setMemberPlan(db, actorId, maskedUserId, plan, days) {
  const actorLabel = !actorId ? 'admin' : (String(actorId).startsWith('admin:') ? String(actorId) : `admin:${actorId}`);
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
actorId: actorLabel,
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
// 任务AD 签名对齐：新口径 (db, actorId, maskedUserId)；旧口径 (db, maskedUserId) 双兼容。
async function quotaUsage(db, actorId, maskedUserId) {
  if (maskedUserId === undefined) maskedUserId = actorId;
const user = await findUserByMask(db, maskedUserId);
const successfulInvites = await quota.countSuccessfulInvites(db, user._id);
const inviteSettings = await quota.resolveInviteSettings(db);
const planQuota = await quota.resolveMemberBaseQuota(db, user, StaticConfig);
const q = quota.getEffectiveQuota(user, StaticConfig, Date.now(), { successfulInvites, settings: inviteSettings, planQuota });
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
// 任务AD：actorId 为 api 分发约定预留（同 overview），本函数不按调用者过滤。
async function inviteStats(db, actorId) {
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
// 任务AD 签名对齐：新口径 (db, actorId, opts)；旧口径 (db, opts) 双兼容（同 memberList）。
async function shareOverview(db, actorId, opts) {
  const { limit = 200 } = (opts === undefined && actorId && typeof actorId === 'object') ? actorId : (opts || {});
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
function consoleAdminIds(doc) {
return doc && Array.isArray(doc.adminIds) ? doc.adminIds : [];
}
function addedAdminIds(doc) {
return doc && Array.isArray(doc.addedAdminIds) ? doc.addedAdminIds : [];
}
function effectiveAdminIds(doc) {
return [...new Set([...consoleAdminIds(doc), ...addedAdminIds(doc)])];
}

async function isAdmin(db, actorId) {
if (!actorId) return false;
const doc = await readConfigDoc(db);
return effectiveAdminIds(doc).includes(actorId);
}

/** 能否增减管理员：只有云端后台导入的管理员（adminIds 本档）可以 */
async function canManageAdmins(db, actorId) {
if (!actorId) return false;
const doc = await readConfigDoc(db);
return consoleAdminIds(doc).includes(actorId);
}

function rosterDenied() {
const e = new Error('无权限：只有云端后台导入的管理员可以增减管理员');
e.code = 'roster-manager-only';
return e;
}
function badRoster(msg) {
const e = new Error(msg);
e.code = 'bad-roster';
return e;
}

/** 增减管理员的前置：先是管理员，再是云端导入的管理员 */
async function requireAdminManager(db, actorId) {
await requireAdmin(db, actorId);
if (!(await canManageAdmins(db, actorId))) throw rosterDenied();
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
pricing: doc.pricing || (StaticConfig.pricing || []).map((x) => ({ ...x })),
points: await points.resolvePointsSettings(db),
paymentPlatforms: doc.paymentPlatforms || { ...(StaticConfig.payment ? StaticConfig.payment.platforms : {}) },
paymentEnabled: (doc.payment && typeof doc.payment.enabled === 'boolean') ? doc.payment.enabled : !!(StaticConfig.payment && StaticConfig.payment.enabled),
photoImportEnabled: (doc.features && typeof doc.features.photoImport === 'boolean') ? doc.features.photoImport : !!(StaticConfig.features && StaticConfig.features.photoImport),
eInvitationEnabled: (doc.features && typeof doc.features.eInvitation === 'boolean') ? doc.features.eInvitation : !!(StaticConfig.features && StaticConfig.features.eInvitation),
familyShareEnabled: (doc.features && typeof doc.features.familyShare === 'boolean') ? doc.features.familyShare : !!(StaticConfig.features && StaticConfig.features.familyShare),
maintenanceEnabled: (doc.features && typeof doc.features.maintenance === 'boolean') ? doc.features.maintenance : !!(StaticConfig.features && StaticConfig.features.maintenance),
registrationEnabled: (doc.features && typeof doc.features.registration === 'boolean') ? doc.features.registration : !!(StaticConfig.features && StaticConfig.features.registration),
landscapeEnabled: (doc.features && typeof doc.features.landscape === 'boolean') ? doc.features.landscape : !!(StaticConfig.features && StaticConfig.features.landscape),
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
* plans: [{id, name, priceFen(分), days, grantPoints?, recommended?, onShelf?,
*   androidPriceFen?(分), iosPriceFen?(分)}]，
* 最多10个，id 唯一；grantPoints=购买赠送积分（缺省0），recommended=标"推荐"
* （缺省false），onShelf=上架开关（缺省true，false 即一键下架）。
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
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(id)) throw badConfig(`档位id不合法:${id}`); // 允许大小写：存量档位 id halfYear 含大写（2026-10-24 真机保存失败实锤——原小写正则把默认四档里的半年卡拒之门外）
if (seen.has(id)) throw badConfig(`档位id重复:${id}`);
seen.add(id);
const name = String(p.name || '').trim();
if (!name || name.length > 20) throw badConfig('档位名称不能为空且不超过20字');
if (!Number.isInteger(p.priceFen) || p.priceFen < 0 || p.priceFen > 100000000) {
throw badConfig('价格（分）必须为0~100000000的整数');
}
// DJ批：分平台价（可选；给了必须为0~100000000的整数，不给则不落库、购买仍走 priceFen）
let androidPriceFen; let iosPriceFen;
if (p.androidPriceFen!== undefined) {
if (!Number.isInteger(p.androidPriceFen) || p.androidPriceFen < 0 || p.androidPriceFen > 100000000) {
throw badConfig('安卓价（分）必须为0~100000000的整数');
}
androidPriceFen = p.androidPriceFen;
}
if (p.iosPriceFen!== undefined) {
if (!Number.isInteger(p.iosPriceFen) || p.iosPriceFen < 0 || p.iosPriceFen > 100000000) {
throw badConfig('苹果价（分）必须为0~100000000的整数');
}
iosPriceFen = p.iosPriceFen;
}
if (!Number.isInteger(p.days) || p.days < 1 || p.days > 3650) {
throw badConfig('天数必须为1~3650的整数');
}
let grantPoints = 0;
if (p.grantPoints!== undefined) {
if (!Number.isInteger(p.grantPoints) || p.grantPoints < 0 || p.grantPoints > 100000) {
throw badConfig('赠送积分必须为0~100000的整数');
}
grantPoints = p.grantPoints;
}
let recommended = false;
if (p.recommended!== undefined) {
if (typeof p.recommended!== 'boolean') throw badConfig('推荐标记必须为开/关');
recommended = p.recommended;
}
let onShelf = true;
if (p.onShelf!== undefined) {
if (typeof p.onShelf!== 'boolean') throw badConfig('上架开关必须为开/关');
onShelf = p.onShelf;
}
const out = { id, name, priceFen: p.priceFen, days: p.days, grantPoints, recommended, onShelf};
if (androidPriceFen!== undefined) out.androidPriceFen = androidPriceFen;
if (iosPriceFen!== undefined) out.iosPriceFen = iosPriceFen;
// 档位额度（2026-10-25 会员额度按档位分）：给了就必须四项齐全合法
// （与 quota.sanitizePlanQuota 的全有全无口径一致，避免半份配置静默兜底）
if (p.quota!== undefined) {
checkQuotaPatch(p.quota, `档位${id}额度`);
if (Object.keys(p.quota).length!== QUOTA_KEYS.length) throw badConfig(`档位${id}额度必须四项齐全`);
out.quota = { ...p.quota};
}
return out;
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

/**
* 修改积分规则（仅管理员，任务P2）：registerGrant（注册赠送）/ photoImportCost
* （拍照录入单价）/ packs（积分礼包，可多档增删）至少给一项，按项合并
* （未传的项保持生效值）。校验口径与 updatePricing 一致；落库后
* points.resolvePointsSettings 立即读到新值（下单/页面即时生效），并写审计。
*/
async function updatePointsSettings(db, actorId, { registerGrant, photoImportCost, packs } = {}) {
await requireAdmin(db, actorId);
if (registerGrant === undefined && photoImportCost === undefined && packs === undefined) {
throw badConfig('没有要修改的积分规则');
}
const current = await points.resolvePointsSettings(db);
const next = { registerGrant: current.registerGrant, photoImportCost: current.photoImportCost, packs: current.packs };
const changed = [];
if (registerGrant !== undefined) {
if (!Number.isInteger(registerGrant) || registerGrant < 0 || registerGrant > 100000) {
throw badConfig('注册赠送积分必须为0~100000的整数');
}
next.registerGrant = registerGrant;
changed.push('注册赠送');
}
if (photoImportCost !== undefined) {
if (!Number.isInteger(photoImportCost) || photoImportCost < 0 || photoImportCost > 100000) {
throw badConfig('拍照录入单价必须为0~100000的整数');
}
next.photoImportCost = photoImportCost;
changed.push('拍照录入单价');
}
if (packs !== undefined) {
if (!Array.isArray(packs) || packs.length > 10) throw badConfig('积分礼包必须是数组（最多10个）');
const seen = new Set();
next.packs = packs.map((p) => {
if (!p || typeof p !== 'object') throw badConfig('礼包格式不对');
const id = String(p.id || '');
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(id)) throw badConfig(`礼包id不合法:${id}`); // 同上
if (seen.has(id)) throw badConfig(`礼包id重复:${id}`);
seen.add(id);
const name = String(p.name || '').trim();
if (!name || name.length > 20) throw badConfig('礼包名称不能为空且不超过20字');
if (!Number.isInteger(p.priceFen) || p.priceFen < 0 || p.priceFen > 100000000) {
throw badConfig('礼包价格（分）必须为0~100000000的整数');
}
// 分平台价（2026-10-30，与会员档 DJ 批同口径：可选；给了必须为0~100000000的整数，不给则不落库、购买仍走 priceFen）
let androidPriceFen; let iosPriceFen;
if (p.androidPriceFen!== undefined) {
if (!Number.isInteger(p.androidPriceFen) || p.androidPriceFen < 0 || p.androidPriceFen > 100000000) {
throw badConfig('礼包安卓价（分）必须为0~100000000的整数');
}
androidPriceFen = p.androidPriceFen;
}
if (p.iosPriceFen!== undefined) {
if (!Number.isInteger(p.iosPriceFen) || p.iosPriceFen < 0 || p.iosPriceFen > 100000000) {
throw badConfig('礼包苹果价（分）必须为0~100000000的整数');
}
iosPriceFen = p.iosPriceFen;
}
if (!Number.isInteger(p.points) || p.points < 1 || p.points > 100000) {
throw badConfig('礼包积分必须为1~100000的整数');
}
const packOut = { id, name, priceFen: p.priceFen, points: p.points };
if (androidPriceFen!== undefined) packOut.androidPriceFen = androidPriceFen;
if (iosPriceFen!== undefined) packOut.iosPriceFen = iosPriceFen;
return packOut;
});
changed.push('积分礼包');
}
const updatedAt = await writeConfigPatch(db, actorId, { points: next }, `修改积分规则：${changed.join('、')}`);
return { points: next, updatedAt };
}

/**
* 修改支付平台开关（仅管理员，任务P2）：platforms 形如
* {ios:{purchaseEnabled}, android:{purchaseEnabled}}，按终端合并
* （未传的终端保持生效值）。购买页在 data-service 侧用「静态配置 +
* 本段覆盖」合并后调 payment.resolvePlatformPurchaseEnabled 决定入口显隐；
* 改开关不动任何页面代码（应对某终端虚拟商品规则变化时先行关闭）。
*/
const KNOWN_PAY_PLATFORMS = ['ios', 'android'];
async function updatePaymentPlatforms(db, actorId, platforms) {
await requireAdmin(db, actorId);
if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) throw badConfig('平台开关必须是对象');
const keys = Object.keys(platforms);
if (keys.length === 0) throw badConfig('平台开关不能为空');
for (const k of keys) {
if (!KNOWN_PAY_PLATFORMS.includes(k)) throw badConfig(`未知终端:${k}`);
const v = platforms[k];
if (!v || typeof v !== 'object' || typeof v.purchaseEnabled !== 'boolean') {
throw badConfig(`终端${k}的购买开关必须为开/关`);
}
}
const doc = (await readConfigDoc(db)) || {};
const base = doc.paymentPlatforms || (StaticConfig.payment ? StaticConfig.payment.platforms : {});
const merged = { ...base };
for (const k of keys) merged[k] = { ...(base[k] || {}), purchaseEnabled: platforms[k].purchaseEnabled };
const updatedAt = await writeConfigPatch(db, actorId, { paymentPlatforms: merged }, `修改支付平台开关：${keys.join('、')}`);
return { paymentPlatforms: merged, updatedAt };
}

/**
 * 修改第一版发布开关（仅管理员，任务AF）：云端购买总开关 +
 * 拍照导入开关。写入 appConfig 文档 payment.enabled / features.photoImport
 * 段（与生效读取同口径：文档优先、静态默认兜底）。两个开关第一版默认关。
 */
async function updateLaunchSwitches(db, actorId, switches) {
await requireAdmin(db, actorId);
if (!switches || typeof switches !== 'object' || Array.isArray(switches)) throw badConfig('发布开关必须是对象');
if ('paymentEnabled' in switches && typeof switches.paymentEnabled !== 'boolean') throw badConfig('云端购买开关必须为开/关');
if ('photoImportEnabled' in switches && typeof switches.photoImportEnabled !== 'boolean') throw badConfig('拍照导入开关必须为开/关');
if ('eInvitationEnabled' in switches && typeof switches.eInvitationEnabled !== 'boolean') throw badConfig('电子请柬开关必须为开/关');
if ('familyShareEnabled' in switches && typeof switches.familyShareEnabled !== 'boolean') throw badConfig('家庭共享开关必须为开/关');
if ('maintenanceEnabled' in switches && typeof switches.maintenanceEnabled !== 'boolean') throw badConfig('维护模式开关必须为开/关');
if ('registrationEnabled' in switches && typeof switches.registrationEnabled !== 'boolean') throw badConfig('注册开关必须为开/关');
if ('landscapeEnabled' in switches && typeof switches.landscapeEnabled !== 'boolean') throw badConfig('横置礼单本开关必须为开/关');
const hasPay = typeof switches.paymentEnabled === 'boolean';
const hasPhoto = typeof switches.photoImportEnabled === 'boolean';
const hasInvite = typeof switches.eInvitationEnabled === 'boolean';
const hasShare = typeof switches.familyShareEnabled === 'boolean';
const hasMaint = typeof switches.maintenanceEnabled === 'boolean';
const hasReg = typeof switches.registrationEnabled === 'boolean';
const hasLand = typeof switches.landscapeEnabled === 'boolean';
if (!hasPay && !hasPhoto && !hasInvite && !hasShare && !hasMaint && !hasReg && !hasLand) throw badConfig('发布开关不能为空');
const doc = (await readConfigDoc(db)) || {};
const patch = {};
const changed = [];
if (hasPay) { patch.payment = { ...(doc.payment || {}), enabled: switches.paymentEnabled }; changed.push('云端购买'); }
if (hasPhoto || hasInvite || hasShare || hasMaint || hasReg || hasLand) {
patch.features = { ...(doc.features || {}) };
if (hasPhoto) { patch.features.photoImport = switches.photoImportEnabled; changed.push('拍照导入'); }
if (hasInvite) { patch.features.eInvitation = switches.eInvitationEnabled; changed.push('电子请柬'); }
if (hasShare) { patch.features.familyShare = switches.familyShareEnabled; changed.push('家庭共享'); }
if (hasMaint) { patch.features.maintenance = switches.maintenanceEnabled; changed.push('维护模式'); }
if (hasReg) { patch.features.registration = switches.registrationEnabled; changed.push('新用户注册'); }
if (hasLand) { patch.features.landscape = switches.landscapeEnabled; changed.push('横置礼单本'); }
}
const updatedAt = await writeConfigPatch(db, actorId, patch, `修改发布开关：${changed.join('、')}`);
const after = (await readConfigDoc(db)) || {};
return {
paymentEnabled: (after.payment && typeof after.payment.enabled === 'boolean') ? after.payment.enabled : !!(StaticConfig.payment && StaticConfig.payment.enabled),
photoImportEnabled: (after.features && typeof after.features.photoImport === 'boolean') ? after.features.photoImport : !!(StaticConfig.features && StaticConfig.features.photoImport),
eInvitationEnabled: (after.features && typeof after.features.eInvitation === 'boolean') ? after.features.eInvitation : !!(StaticConfig.features && StaticConfig.features.eInvitation),
familyShareEnabled: (after.features && typeof after.features.familyShare === 'boolean') ? after.features.familyShare : !!(StaticConfig.features && StaticConfig.features.familyShare),
maintenanceEnabled: (after.features && typeof after.features.maintenance === 'boolean') ? after.features.maintenance : !!(StaticConfig.features && StaticConfig.features.maintenance),
registrationEnabled: (after.features && typeof after.features.registration === 'boolean') ? after.features.registration : !!(StaticConfig.features && StaticConfig.features.registration),
landscapeEnabled: (after.features && typeof after.features.landscape === 'boolean') ? after.features.landscape : !!(StaticConfig.features && StaticConfig.features.landscape),
updatedAt,
};
}

// ================= 补全项（任务M：第3/4/6/7/10/11项接真接口） =================
//
// 共同纪律（与文件头铁律一致）：
// - 全部接口先 requireAdmin（只认 appConfig 文档 adminIds，无名单一律拒绝）；
// - 返回只含白名单字段、逐个手写构造；userId/actorId 一律脱敏；
// - 账号查询只返回条数级汇总（各集合 count），绝不返回记录行；
// - 订单金额是平台订单数据（非用户账本礼金），按任务口径可列；
// - 反馈正文是用户主动提交给平台的文字，按任务口径可显示。

function pageSlice(all, { page = 1, pageSize = 20 } = {}) {
const p = Math.max(1, page | 0);
const ps = Math.min(100, Math.max(1, pageSize | 0));
return { p, ps, items: all.slice((p - 1) * ps, p * ps) };
}

/** 审计 actor 脱敏：'admin:openid' 保留前缀只脱敏后段；短系统标识原样 */
function maskActorId(actorId) {
const s = String(actorId || '');
const i = s.indexOf(':');
if (i >= 0) return `${s.slice(0, i + 1)}${maskUserId(s.slice(i + 1))}`;
if (s.length <= 8) return s; // system / pay-notify 等系统标识
return maskUserId(s);
}

/**
* 账号查询（第3项，客服用）：按脱敏编号片段或注册时间段查用户。
* 每条只回：脱敏编号、注册时间、会员状态、条数汇总、受限状态。
* @returns {{total, page, pageSize, items: [{userId, createdAt, memberState,
* counts: {events, records, gifts, contacts}, restricted, restrictReason}]}}
*/
async function searchAccounts(db, actorId, { maskedId, from, to, page, pageSize } = {}) {
await requireAdmin(db, actorId);
let users = await db.collection(COLLECTIONS.User).find({}, { sort: { createdAt: -1 } });
if (maskedId) {
const frag = String(maskedId).toLowerCase();
users = users.filter((u) => maskUserId(u._id).toLowerCase().includes(frag));
}
if (Number.isFinite(from)) users = users.filter((u) => (u.createdAt || 0) >= from);
if (Number.isFinite(to)) users = users.filter((u) => (u.createdAt || 0) <= to);
const total = users.length;
const { p, ps, items: pageUsers } = pageSlice(users, { page, pageSize });
const cfgDoc = (await readConfigDoc(db)) || {};
const adminSet = new Set(effectiveAdminIds(cfgDoc));
const items = [];
for (const u of pageUsers) {
items.push({
userId: maskUserId(u._id),
isAdmin: adminSet.has(u._id),
createdAt: u.createdAt || null,
memberState: quota.getMembershipState(u),
counts: {
events: await countCol(db, 'ReceiveEvent', { ownerId: u._id }),
records: await countCol(db, 'ReceiveRecord', { ownerId: u._id }),
gifts: await countCol(db, 'GiftRecord', { ownerId: u._id }),
contacts: await countCol(db, 'Contact', { ownerId: u._id }),
},
restricted: !!(u.restricted && u.restricted.status === true),
restrictReason: (u.restricted && u.restricted.reason) || '',
});
}
return { total, page: p, pageSize: ps, items, viewerCanManage: consoleAdminIds(cfgDoc).includes(actorId) };
}

/** 周期键：day → 'YYYY-MM-DD'（本地）；week → 该周周一的 'YYYY-MM-DD' */
function periodKey(ts, granularity) {
const d = new Date(ts);
if (granularity === 'week') {
const day = (d.getDay() + 6) % 7; // 距周一的天数
d.setDate(d.getDate() - day);
}
const m = `${d.getMonth() + 1}`.padStart(2, '0');
const dd = `${d.getDate()}`.padStart(2, '0');
return `${d.getFullYear()}-${m}-${dd}`;
}

/**
* 拍照导入用量（第4项）：按日/周聚合 ImportJob。
* 只有次数、成功率、失败大类分布——无图片、无识别内容、无账本字段。
* @returns {{total, success, failed, partial, successRate,
* byPeriod: [{key, total, success, failed, partial}],
* failReasons: [{reason, count}]}}
*/
async function importUsage(db, actorId, { granularity = 'day' } = {}) {
await requireAdmin(db, actorId);
if (!['day', 'week'].includes(granularity)) throw badConfig('统计粒度只能是 day 或 week');
const jobs = await db.collection(COLLECTIONS.ImportJob).find({});
let success = 0;
let failed = 0;
let partial = 0;
const periods = new Map();
const reasons = new Map();
for (const j of jobs) {
if (j.status === 'recognized') continue; // AS批识别留痕文档不是一次完成导入，不计用量
const st = j.status === 'success' ? 'success' : j.status === 'partial' ? 'partial' : 'failed';
if (st === 'success') success += 1; else if (st === 'partial') partial += 1; else failed += 1;
const key = periodKey(j.createdAt || 0, granularity);
const row = periods.get(key) || { key, total: 0, success: 0, failed: 0, partial: 0 };
row.total += 1;
row[st] += 1;
periods.set(key, row);
if (st !== 'success') {
const r = j.failReason || 'validation';
reasons.set(r, (reasons.get(r) || 0) + 1);
}
}
const total = success + failed + partial; // 已跳过 'recognized' 留痕文档
return {
total, success, failed, partial,
successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : 0,
byPeriod: [...periods.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
failReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count }))
.sort((a, b) => b.count - a.count),
};
}

/** 用户反馈列表（第6项）：转 core/feedback 的管理员列表（userId 已脱敏） */
async function feedbackList(db, actorId, opts = {}) {
await requireAdmin(db, actorId);
return feedback.listFeedbackForAdmin(db, opts);
}

/** 用户反馈标记处理状态（第6项）：写审计 */
async function feedbackSetStatus(db, actorId, feedbackId, status) {
await requireAdmin(db, actorId);
const r = await feedback.setFeedbackStatus(db, feedbackId, status);
if (!r.ok) throw new Error('admin:feedback-not-found');
await audit.log(db, {
ownerId: actorId, actorId, action: 'feedback', targetType: 'feedback',
targetId: String(feedbackId), detail: status === 'handled' ? '反馈标记为已处理' : '反馈标记为待处理',
});
return r;
}

function orderRow(o) {
return {
orderId: o._id,
outTradeNo: o.outTradeNo,
userId: maskUserId(o.userId),
planName: o.planName,
amountFen: o.amountFen,
days: o.days,
status: o.status,
channel: o.channel,
mock: o.mock === true,
createdAt: o.createdAt,
paidAt: o.paidAt || null,
refundedAt: o.refundedAt || null,
};
}

/**
* 会员订单列表（第7项）：脱敏用户、档位名、订单金额、状态、时间。
* 订单金额是平台订单数据，不是用户账本礼金，可按任务口径列出。
*/
async function orderList(db, actorId, { page, pageSize, status } = {}) {
await requireAdmin(db, actorId);
let orders = await db.collection(COLLECTIONS.Order).find({}, { sort: { createdAt: -1 } });
if (status) orders = orders.filter((o) => o.status === status);
const total = orders.length;
const { p, ps, items } = pageSlice(orders, { page, pageSize });
return { total, page: p, pageSize: ps, items: items.map(orderRow) };
}

/**
* 会员收入汇总（第7项）：按状态计数、按档位聚合。
* revenueFen = 当前 paid 订单金额合计；refundedFen = 已退款订单金额合计。
*/
async function orderStats(db, actorId) {
await requireAdmin(db, actorId);
const orders = await db.collection(COLLECTIONS.Order).find({});
const byStatus = { pending: 0, paid: 0, failed: 0, cancelled: 0, refunded: 0 };
let paidRevenueFen = 0;
let refundedFen = 0;
const planMap = new Map();
for (const o of orders) {
if (byStatus[o.status] !== undefined) byStatus[o.status] += 1;
if (o.status === 'paid') paidRevenueFen += o.amountFen || 0;
if (o.status === 'refunded') refundedFen += o.amountFen || 0;
const row = planMap.get(o.planId) || {
planId: o.planId, planName: o.planName, orders: 0, paidCount: 0, revenueFen: 0,
};
row.orders += 1;
if (o.status === 'paid') { row.paidCount += 1; row.revenueFen += o.amountFen || 0; }
planMap.set(o.planId, row);
}
return {
totalOrders: orders.length,
byStatus,
paidRevenueFen,
refundedFen,
netRevenueFen: paidRevenueFen,
byPlan: [...planMap.values()],
};
}

/** 管理员名单（第10项）：只读展示（脱敏），名单维护仍走云数据库直写（现行口径） */
function buildAdminList(doc, actorId) {
const admins = [
...consoleAdminIds(doc).map((id) => ({ userId: maskUserId(id), tier: 'console', self: id === actorId })),
...addedAdminIds(doc).map((id) => ({ userId: maskUserId(id), tier: 'added', self: id === actorId })),
];
return { admins, count: admins.length, viewerCanManage: consoleAdminIds(doc).includes(actorId) };
}

async function listAdmins(db, actorId) {
await requireAdmin(db, actorId);
const doc = (await readConfigDoc(db)) || {};
return buildAdminList(doc, actorId);
}

/**
 * 添加管理员（仅云端导入的管理员可操作）：按脱敏编号定位用户，
 * 写入 addedAdminIds（后加档），写审计。对方须已打开过小程序（用户文档存在）。
 */
async function addAdmin(db, actorId, { maskedId } = {}) {
await requireAdminManager(db, actorId);
if (!maskedId) throw badRoster('缺少用户编号');
let target;
try {
target = await findUserByMask(db, String(maskedId));
} catch (e) {
if (e.message === 'admin:user-not-found') throw badRoster('没有找到这个编号对应的用户');
if (e.message === 'admin:mask-collision') throw badRoster('这个编号对应多个用户，无法确定是哪一位');
throw e;
}
const doc = (await readConfigDoc(db)) || {};
if (effectiveAdminIds(doc).includes(target._id)) throw badRoster('该用户已经是管理员');
const added = [...addedAdminIds(doc), target._id];
await db.collection(COLLECTIONS.AppConfig).update({ _id: CONFIG_DOC_ID }, { addedAdminIds: added, updatedAt: now() });
await audit.log(db, {
ownerId: actorId, actorId, action: 'admin-add', targetType: 'admin',
targetId: maskUserId(target._id), detail: `添加管理员：${maskUserId(target._id)}（后加管理员，不能增减管理员）`,
});
return buildAdminList({ ...doc, addedAdminIds: added }, actorId);
}

/**
 * 移除管理员（仅云端导入的管理员可操作）：按脱敏编号定位名单条目。
 * 护栏：不能移除最后一位云端管理员（否则再无人能增减管理员）。
 */
async function removeAdmin(db, actorId, { maskedId } = {}) {
await requireAdminManager(db, actorId);
if (!maskedId) throw badRoster('缺少用户编号');
const doc = (await readConfigDoc(db)) || {};
const consoleIds = consoleAdminIds(doc);
const addedIds = addedAdminIds(doc);
const inConsole = consoleIds.filter((id) => maskUserId(id) === maskedId);
const inAdded = addedIds.filter((id) => maskUserId(id) === maskedId);
if (!inConsole.length && !inAdded.length) throw badRoster('该编号不在管理员名单里');
if (inConsole.length && inAdded.length && inConsole[0] !== inAdded[0]) {
throw badRoster('这个编号对应多位管理员，无法确定要移除哪一位');
}
const targetId = (inConsole[0] || inAdded[0]);
if (inConsole.length && consoleIds.length <= 1) throw badRoster('不能移除最后一位云端管理员');
const nextConsole = consoleIds.filter((id) => id !== targetId);
const nextAdded = addedIds.filter((id) => id !== targetId);
await db.collection(COLLECTIONS.AppConfig).update(
{ _id: CONFIG_DOC_ID },
{ adminIds: nextConsole, addedAdminIds: nextAdded, updatedAt: now() },
);
await audit.log(db, {
ownerId: actorId, actorId, action: 'admin-remove', targetType: 'admin',
targetId: maskUserId(targetId), detail: `移除管理员：${maskUserId(targetId)}${targetId === actorId ? '（移除自己）' : ''}`,
});
return buildAdminList({ ...doc, adminIds: nextConsole, addedAdminIds: nextAdded }, actorId);
}

/**
* 操作记录（第10项）：AuditLog 查询，可按 action 过滤。
* actor 一律脱敏；detail 本就是不含账本内容的摘要，原样带出。
*/
async function auditTrail(db, actorId, { action, page, pageSize } = {}) {
await requireAdmin(db, actorId);
const query = action ? { action } : {};
const all = await db.collection(COLLECTIONS.AuditLog).find(query, { sort: { createdAt: -1 } });
const total = all.length;
const { p, ps, items } = pageSlice(all, { page, pageSize });
return {
total, page: p, pageSize: ps,
items: items.map((a) => ({
action: a.action,
targetType: a.targetType,
detail: a.detail || '',
actorId: maskActorId(a.actorId),
createdAt: a.createdAt,
})),
};
}

/**
* 异常用户限制（第11项）：给用户打/摘 restricted 标记并写审计。
* 标记生效后，core/restriction.assertWritable 在全部核心写入口拦截该用户。
* @param {{restricted:boolean, reason?:string}} input 限制时 reason 必填（≤100字）
*/
async function setUserRestricted(db, actorId, maskedUserId, { restricted, reason } = {}) {
await requireAdmin(db, actorId);
if (typeof restricted !== 'boolean') throw badConfig('限制状态必须为开/关');
const cleanReason = String(reason || '').trim();
if (restricted && !cleanReason) throw badConfig('限制用户时必须填写原因');
if (cleanReason.length > 100) throw badConfig('限制原因不超过100字');
const user = await findUserByMask(db, maskedUserId);
const at = now();
await db.collection(COLLECTIONS.User).update(
{ _id: user._id },
{ restricted: { status: restricted, reason: restricted ? cleanReason : '', by: actorId, at } }
);
await audit.log(db, {
ownerId: actorId, actorId,
action: restricted ? 'restrict' : 'unrestrict',
targetType: 'user', targetId: maskedUserId,
detail: restricted ? `限制用户记账：${cleanReason}` : '解除用户限制',
});
return { userId: maskedUserId, restricted, reason: restricted ? cleanReason : '' };
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
updatePointsSettings,
updatePaymentPlatforms,
updateLaunchSwitches,
searchAccounts,
importUsage,
feedbackList,
feedbackSetStatus,
orderList,
orderStats,
listAdmins,
addAdmin,
removeAdmin,
canManageAdmins,
auditTrail,
setUserRestricted,
};
