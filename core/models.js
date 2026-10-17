/**
 * 礼单簿 · 数据字典（T1.1）
 * 基线：v3.1 §17.2。金额一律整数"分"存储。不设 RecycleBin、不设 ReceiveProject。
 *
 * 集合一览：
 * User / Contact / ReceiveEvent / ReceiveRecord / GiftRecord /
 * ShareMembership / ShareGrant / AuditLog / ImportJob / ExportJob / AppConfig
 */

const COLLECTIONS = {
  User: 'users',
  Contact: 'contacts',
  ReceiveEvent: 'receiveEvents',
  ReceiveRecord: 'receiveRecords',
  GiftRecord: 'giftRecords',
  ShareMembership: 'shareMemberships',
  ShareGrant: 'shareGrants',
  AuditLog: 'auditLogs',
  ImportJob: 'importJobs',
  ExportJob: 'exportJobs',
  AppConfig: 'appConfig',
};

/**
 * 实体字段说明（code 注释即字典；完整版见 docs/数据字典.md）
 *
 * User: {_id(openid), nickname?, membership:{status:'free'|'member', expireAt: timestamp|null, graceUntil: timestamp|null}, createdAt}
 * Contact: {_id, ownerId, name, remark, createdAt}  // 只有姓名+备注，无手机号
 * ReceiveEvent: {_id, ownerId, name, tagId(10选1), date(YYYY-MM-DD), remark, createdAt}
 * ReceiveRecord: {_id, ownerId, eventId, contactId(稳定ID), amount(分), type(红包/现金/转账/微信/支付宝), remark, date, createdBy(openid), createdAt}
 * GiftRecord: {_id, ownerId, contactId(稳定ID), tagId, amount(分), remark, date, createdBy(openid), createdAt}
 * ShareMembership: {_id, ownerId(账本主人), memberId(成员openid), status:'pending'|'active'|'removed', createdAt}
 * ShareGrant: {_id, membershipId, switches:{view,add,edit,del,export}, scope:{events:[eventId], gifts:bool}, updatedAt}
 *   // view 恒 true；export 默认 false；新建事件默认不共享（不自动进 scope.events）
 * AuditLog: {_id, ownerId, actorId, action, targetType, targetId, detail(不含金额/姓名原文的摘要), createdAt}
 * ImportJob: {_id, ownerId, kind:'gift'|'receive', eventId?, status, createdAt}  // 阶段4用，T1.1只建模
 * ExportJob: {_id, ownerId, scope, status, createdAt}  // 阶段3用，T1.1只建模
 * AppConfig: {_id:'singleton', freeQuota, membership, inviteReward(预留), updatedAt}
 */

function now() {
  return Date.now();
}

module.exports = { COLLECTIONS, now };
