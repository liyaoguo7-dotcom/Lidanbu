/**
* 礼单簿 · 服务端授权中间层（T1.2，补强版）
*
* 铁律（v3.1 §2.5、§8.6）：每次读取、新增、修改、删除、导出都校验；
* 校验链：身份 → 共享关系 → 范围 → 开关。任何接口不得绕过。
*
* 补强（阶段1有条件验收）：
* - 身份任一为空（actorId/ownerId）一律拒绝
* - 授权记录缺失字段 → 明确拒绝，不抛错、不放行
* - 无查看权限 → 新增/修改/删除/导出一律拒绝
*
* 口径说明：
* - 本人（actorId === ownerId）：全部放行。
* - 成员：需 ShareMembership(status=active) + ShareGrant 开关 + 范围。
* 每次实时查询，不缓存 → 撤销授权立即生效。
* - 联系人可见范围按第19章#3"建议"实现（只显示已授权记录里出现过的联系人），
* ，见阶段1报告疑问清单。
* - 成员不可增删改主人亲友录的联系人（联系人归属主人；成员新增记录时只能
* 选择已授权可见的联系人）。
*/

const { COLLECTIONS} = require('./models');

const OP_SWITCH = {
read: 'view',
add: 'add',
edit: 'edit',
delete: 'del',
export: 'export',
};

/**
* 取成员对某账本的有效授权（active 成员关系 + 授权单）
* @returns {grant|null}
*/
async function getGrant(db, ownerId, memberId) {
const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({
ownerId,
memberId,
status: 'active',
});
if (!ms) return null;
const grant = await db.collection(COLLECTIONS.ShareGrant).findOne({
membershipId: ms._id,
});
return grant;
}

/**
* 联系人是否在成员授权范围内（出现在已授权记录中）
* @param {object} scope 已清洗的 scope {events:[], gifts:bool}
*/
async function contactInScope(db, scope, ownerId, contactId) {
const events = Array.isArray(scope.events)? scope.events: [];
// 收礼：联系人出现在已授权事件的记录里
if (events.length) {
const n = await db.collection(COLLECTIONS.ReceiveRecord).count({
ownerId,
contactId,
eventId: { $in: events},
});
if (n > 0) return true;
}
// 送礼：scope.gifts 开且联系人出现在送礼记录里
if (scope.gifts) {
const n = await db.collection(COLLECTIONS.GiftRecord).count({
ownerId,
contactId,
});
if (n > 0) return true;
}
return false;
}

/**
* 授权校验主入口
* @param {object} db 数据库（MemoryDB / CloudDB）
* @param {string} actorId 操作者 openid
* @param {string} op read|add|edit|delete|export
* @param {object} resource {kind:'event'|'receiveRecord'|'giftRecord'|'contact', ownerId, eventId?, contactId?}
* @returns {{ok:boolean, reason:string}}
*/
async function check(db, actorId, op, resource) {
const { kind, ownerId} = resource;
const needSwitch = OP_SWITCH[op];
if (!needSwitch) return { ok: false, reason: `未知操作:${op}`};

// 身份任一为空，一律拒绝（必须在"本人"判断之前）
if (!actorId ||!ownerId) return { ok: false, reason: 'empty-identity'};

// 1. 身份：本人直接放行
if (actorId === ownerId) return { ok: true, reason: 'owner'};

// 2. 共享关系：必须有 active 的成员关系
const grant = await getGrant(db, ownerId, actorId);
if (!grant) return { ok: false, reason: 'no-active-membership'};

// 授权记录字段缺失 → 明确拒绝，不抛错、不放行
const switches = (grant && grant.switches) || {};
const rawScope = (grant && grant.scope) || {};
const scope = {
events: Array.isArray(rawScope.events)? rawScope.events: [],
gifts:!!rawScope.gifts,
};

// 没有查看权限，新增/修改/删除/导出一律拒绝
if (!switches.view) return { ok: false, reason: 'switch-off:view'};

// 3. 开关
if (!switches[needSwitch]) {
return { ok: false, reason: `switch-off:${needSwitch}`};
}
// view 恒开由发邀请时保证；此处仍按开关值判断

// 4. 范围（不信任调用方传入的 id，只认授权单里的范围）
if (kind === 'giftRecord') {
if (!scope.gifts) return { ok: false, reason: 'out-of-scope:gifts'};
return { ok: true, reason: 'member'};
}
if (kind === 'event' || kind === 'receiveRecord') {
const eventId = resource.eventId;
if (!eventId ||!scope.events.includes(eventId)) {
return { ok: false, reason: 'out-of-scope:event'};
}
return { ok: true, reason: 'member'};
}
if (kind === 'contact') {
// 读：只放行已授权记录里出现过的联系人；增删改：成员一律不许动主人亲友录
if (op === 'read') {
const inScope = await contactInScope(db, scope, ownerId, resource.contactId);
return inScope
? { ok: true, reason: 'member'}
: { ok: false, reason: 'out-of-scope:contact'};
}
return { ok: false, reason: 'member-cannot-touch-owner-contacts'};
}

return { ok: false, reason: `未知资源:${kind}`};
}

module.exports = { check, getGrant, OP_SWITCH};
