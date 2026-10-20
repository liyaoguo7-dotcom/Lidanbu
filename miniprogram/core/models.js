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
  InviteBinding: 'inviteBindings', // 邀请关系绑定记录（防重复绑定/防刷，注销后保留以防重复计数）
  // —— 老板平台预留（只存数量与时间，不存账本内容）——
  InviteRewardGrant: 'inviteRewardGrants', // 邀请奖励发放记录
};

/**
 * 实体字段说明（code 注释即字典；完整版见 docs/数据字典.md）
 *
 * User: {_id(openid), nickname?, inviteCode(我的邀请码,懒生成), membership:{status:'free'|'member', expireAt: timestamp|null, graceUntil: timestamp|null}, createdAt}
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
 * AppConfig: {_id:'singleton', freeQuota, membership, memberOnlyFeatures(会员专属功能清单),
 *   inviteReward(老板平台可覆盖:{enabled, perInvite:{receivePool,giftRecords}, maxSuccessfulInvites}), updatedAt}
 * InviteBinding: {_id, inviterId, inviteeId, code, deviceId(设备指纹占位,可空),
 *   status:'bound'|'granted'|'blocked', boundAt, grantedAt|null}
 *   // 每位被邀请人最多一条；注销清理时不删除（连同发放记录一起防"注销后重复计")
 * InviteRewardGrant: {_id, userId(邀请人), invitedUserId(被邀请人), poolGranted(发放的收礼池数),
 *   giftsGranted(发放的送礼数), deviceId(领取时设备指纹占位,可空), grantedAt}  // 只存数量与时间，不存账本内容；老板平台用
 * ShareOverview（派生视图，非集合，老板平台用）: {ownerId, memberCount, activeMemberCount,
 *   authorizedEventCount, updatedAt}  // 只存数量，不读账本内容
 */

function now() {
  return Date.now();
}

module.exports = { COLLECTIONS, now };
