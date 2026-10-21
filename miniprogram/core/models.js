/**
 * 礼单簿 · 数据字典（T1.1）
 * 基线：v3.1 §17.2。金额一律整数"分"存储。不设 RecycleBin、不设 ReceiveProject。
 *
 * 集合一览：
 * User / Contact / ReceiveEvent / ReceiveRecord / GiftRecord /
 * ShareMembership / ShareGrant / AuditLog / ImportJob / ExportJob / AppConfig /
 * InviteBinding / InviteRewardGrant / Order / PointsLedger / Notification / Feedback
 * （电子请柬 Invitation / Rsvp 已于 2026-10-21 随自制请柬取消而下线删除）
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
  Order: 'orders', // 会员购买订单（支付适配层+模拟支付；真实支付接入后仍用此集合）
  PointsLedger: 'pointsLedger', // 积分流水（余额的对账真源；用户记录上的 pointsBalance 与流水同口径维护）
  // —— 老板平台预留（只存数量与时间，不存账本内容）——
  InviteRewardGrant: 'inviteRewardGrants', // 邀请奖励发放记录
  Notification: 'notifications', // 站内通知（通知中心，任务L）
  Feedback: 'feedbacks', // 用户意见反馈（任务L；老板平台反馈列表读此集合）
};

/**
 * 实体字段说明（code 注释即字典；完整版见 docs/数据字典.md）
 *
 * User: {_id(openid), nickname?, inviteCode(我的邀请码,懒生成), pointsBalance(积分余额,与 pointsLedger 流水同口径,缺省0),
 *   membership:{status:'free'|'member', expireAt: timestamp|null, graceUntil: timestamp|null},
 *   cancelStatus?:'pendingCancel'(已申请注销、冷静期内), cancelApplyAt?, cancelAt?(冷静期满执行时刻),
 *   restricted?:{status:boolean, reason, by(操作的管理员), at}(老板平台异常用户限制标记；status=true 时核心写入口全拦，只拦写不拦读), createdAt}
 * Contact: {_id, ownerId, name, remark, createdBy(创建者openid), seed?(true=演示种子联系人，普通新建无此字段), createdAt}  // 只有姓名+备注，无手机号
 * ReceiveEvent: {_id, ownerId, name, tagId(10选1), date(YYYY-MM-DD), remark, createdAt}
 * ReceiveRecord: {_id, ownerId, eventId, contactId(稳定ID), amount(分), type(红包/现金/转账/微信/支付宝), remark, date, createdBy(openid), createdAt}
 * GiftRecord: {_id, ownerId, contactId(稳定ID), tagId, amount(分), remark, date, createdBy(openid), createdAt}
 * ShareMembership: {_id, ownerId(账本主人), memberId(成员openid), status:'pending'|'active'|'removed', createdAt}
 * ShareGrant: {_id, membershipId, switches:{view,add,edit,del,export}, scope:{events:[eventId], gifts:bool}, updatedAt}
 *   // view 恒 true；export 默认 false；新建事件默认不共享（不自动进 scope.events）
 * AuditLog: {_id, ownerId, actorId, action, targetType, targetId, detail(不含金额/姓名原文的摘要), createdAt}
 * ImportJob: {_id, ownerId, kind:'gift'|'receive', eventId?, status:'success'|'failed'|'partial',
 *   failReason:'quota'|'validation'|'write-error'|null, itemCount(本批条数), createdAt}
 *   // writeImport 每次确认写入都记一条（只记条数级，供老板平台用量统计；不含姓名/金额/备注）
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
 * Notification: {_id, userId(接收人), type:'membershipExpiring'|'membershipExpired'|'graceEnding'|'inviteRewardGranted'|'shareChanged',
 *   title, body, read:boolean, dedupeKey?(内部去重键，会员提醒/奖励到账防重复发), createdAt}
 * Feedback: {_id, userId(提交人), content(正文), images:[截图占位路径/云文件ID，最多3张],
 *   status:'pending'|'handled'(与老板平台反馈列表"待处理/已处理"口径一致), createdAt}
 * Order: {_id, userId, planId, planName, amountFen(分,下单时快照), days(购买天数快照),
 *   grantPoints(购买赠送积分,下单时快照;发货时经 points.grant 幂等入账),
 *   kind?('plan' 会员套餐 | 'pointsPack' 积分礼包,缺省 'plan'),
 *   pointsAmount?(积分礼包的积分快照,kind='pointsPack' 时;发货经 points.grant(kind='pack_purchase') 幂等入账),
 *   status:'pending'|'paid'|'failed'|'cancelled'|'refunded', channel:'mock'|'wxvirtual',
 *   outTradeNo(业务单号,唯一), channelTradeNo?(渠道单号), createdAt, paidAt|null,
 *   baseAt(发货叠加基准时刻)|null, prevExpireAt(发货前到期时刻)|null,
 *   deliveredExpireAt(发货后到期时刻)|null, refundedAt|null, reclaimedDays(退款回收天数)|null}
 *   // 金额以订单快照为准,回调金额与快照不一致拒绝发货;同一 outTradeNo 重复回调只发货一次
 * PointsLedger: {_id, userId, delta(正入账/负消耗), balanceAfter(本笔后余额), kind, refId(订单号/jobId,幂等键), note, createdAt}
 *   kind: 'register_grant'(注册赠送) | 'plan_grant'(套餐赠送) | 'plan_grant_reversal'(退款回收赠送)
 *       | 'pack_purchase'(积分包购买入账) | 'pack_purchase_reversal'(积分包退款回收)
 *       | 'photo_import'(拍照录入消耗) | 'photo_refund'(拍照失败返还) | 'manual'(人工调整)
 *   // 幂等铁律:同一 (userId, kind, refId) 只入账一次;余额 = User.pointsBalance,与流水 balanceAfter 始终一致
 */

function now() {
  return Date.now();
}

module.exports = { COLLECTIONS, now };
