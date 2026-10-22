/**
* 礼单簿 · 审计日志（T1.7）
*
* 记录：操作者、时间、对象、变更。永久删除也要留审计。
* detail 只写不含金额和姓名原文的摘要（如"删除收礼记录×1"），避免审计库成第二账本。
*
* 账号注销时：删除该用户的账本数据，操作记录只留
* 不含金额和姓名的流水。本函数为预留，不实现、不启用，见阶段1报告疑问清单。
*/

const { COLLECTIONS, now} = require('./models');

async function log(db, { ownerId, actorId, action, targetType, targetId, detail = ''}) {
await db.collection(COLLECTIONS.AuditLog).insert({
ownerId,
actorId,
action, // create|update|delete|share|grant|export|login...
targetType, // contact|event|receiveRecord|giftRecord|member...
targetId,
detail, // 摘要，不含金额/姓名原文
createdAt: now(),
});
}

async function list(db, ownerId, limit = 50) {
return db.collection(COLLECTIONS.AuditLog).find({ ownerId}, { sort: { createdAt: -1}, limit});
}

// 账号注销的数据清理策略：
// 1. 删除该用户所有账本数据（联系人/礼薄/收送记录/共享关系/导入导出任务）
// 2. 审计日志仅保留不含金额和姓名的流水（action/targetType/时间，detail 已脱敏）
// 3. User 本体删除或匿名化（待定）
// 本函数暂不实现，待用户确认后按最终口径编写。
// async function purgeUserOnCancellation(db, ownerId) { /* TODO(待确认) */}

module.exports = { log, list};
