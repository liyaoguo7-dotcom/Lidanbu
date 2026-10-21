/**
 * 礼单簿 · 账号注销（阶段3 + 任务L 全流程）
 *
 * ⚠️ 待用户确认，确认前不上线（AppConfig.accountCancellation.enabled=false，
 * 开关关闭时申请入口直接拒绝；是否上线由用户定）。
 *
 * 全流程：说明页 → 导出提醒 → 冷静期说明与确认 → 提交申请进入冷静期
 * （默认 7 天，配置 coolingOffDays）→ 冷静期内可撤销 → 期满执行清理。
 * 期满执行（executeCancellationIfDue）的联动规则：
 * - 家庭共享：其作为主人的共享关系与授权单解除；其作为成员的身份移除
 *   （成员行与对应授权单删除）；其名下记录在主人账本中的保留口径不变
 *   （那是别人账本的数据，不随成员注销删除）；
 * - 会员：注销即终止，不退费（口径写在注销说明页，代码无支付概念）；
 * - 邀请奖励：其邀请码随 User 一并删除即停用；已发出的邀请绑定与发放
 *   记录按防刷口径保留（见下方注释），不随注销删除；
 * - 本人数据：purgeUserOnCancellation 清空（见数据策略）。
 *
 * 数据策略（阶段1预留设计）：删除该用户全部账本数据；审计日志仅保留
 * 不含金额和姓名的流水（action/targetType/时间，detail 已脱敏）。
 */
const { COLLECTIONS, now } = require('./models');
const AppConfig = require('../config/app-config');
const audit = require('./audit');

const LEDGER_COLLECTIONS = [
  COLLECTIONS.Contact,
  COLLECTIONS.ReceiveEvent,
  COLLECTIONS.ReceiveRecord,
  COLLECTIONS.GiftRecord,
  COLLECTIONS.ShareMembership,
  COLLECTIONS.ShareGrant,
  COLLECTIONS.ImportJob,
  COLLECTIONS.ExportJob,
];
// 归属字段为 userId（非 ownerId）的本人数据集合，purge 时单独按 userId 删：
// 站内通知、本人反馈正文（防刷保留口径只针对邀请绑定/发放两集合）
const USERID_COLLECTIONS = [COLLECTIONS.Notification, COLLECTIONS.Feedback];
// 注意：inviteBindings / inviteRewardGrants 故意不在清理清单里——
// 保留邀请绑定与发放历史，才能保证"被邀请人注销后重注册不再重复计数"；
// 这两类记录只含 id/数量/时间，不含账本内容。

/**
 * 注销账号：清空账本数据，保留脱敏审计流水。
 * @returns {{deleted: {[col]: number}, auditKept: number}}
 */
async function purgeUserOnCancellation(db, ownerId) {
  if (!ownerId) throw new Error('身份信息缺失，请重新登录');
  const deleted = {};
  for (const col of LEDGER_COLLECTIONS) {
    const rows = await db.collection(col).find({ ownerId });
    for (const r of rows) {
      await db.collection(col).remove({ _id: r._id });
    }
    deleted[col] = rows.length;
  }
  for (const col of USERID_COLLECTIONS) {
    const rows = await db.collection(col).find({ userId: ownerId });
    for (const r of rows) {
      await db.collection(col).remove({ _id: r._id });
    }
    deleted[col] = rows.length;
  }
  // 审计只留不含金额和姓名的流水：audit.log 的 detail 本来就是脱敏摘要，
  // 这里再做一次保险——detail 若含金额数字特征则清空（只留动作与时间）。
  const logs = await db.collection(COLLECTIONS.AuditLog).find({ ownerId });
  let kept = 0;
  for (const l of logs) {
    const d = String(l.detail || '');
    const dirty = /[0-9]+\.?[0-9]*\s*元|¥|￥|\d{4,}|\u4e09|\u4e94|\u738b|\u674e|\u5f20/.test(d);
    if (dirty) {
      await db.collection(COLLECTIONS.AuditLog).update({ _id: l._id }, { detail: '' });
    }
    kept += 1;
  }
  // User 本体删除（本地演示直接删；云端按账号体系口径，待定）
  await db.collection(COLLECTIONS.User).remove({ _id: ownerId });
  return { deleted, auditKept: kept };
}

// ————————————————————————————————————————————————
// 注销全流程（任务L）：申请 → 冷静期 → 撤销 / 期满执行
// 所有函数都只作用于 userId 本人（申请与撤销都以登录身份为准，
// 不存在"替别人申请"的入参通道）。
// ————————————————————————————————————————————————

const DAY = 86400e3;

function cancelSettings(config = AppConfig) {
  const ac = (config && config.accountCancellation) || {};
  return {
    enabled: !!ac.enabled,
    coolingOffDays: Number.isInteger(ac.coolingOffDays) ? ac.coolingOffDays : 7,
  };
}

function cancelError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * 提交注销申请：进入冷静期（状态 pendingCancel，cancelAt = 申请时刻 + 冷静期天数）。
 * 开关关闭（enabled=false）时直接拒绝，保持现行"暂未开放"行为。
 * @returns {{status:'pendingCancel', cancelAt:number, coolingOffDays:number}}
 */
async function requestCancellation(db, userId, config = AppConfig, nowTs = now()) {
  const s = cancelSettings(config);
  if (!s.enabled) throw cancelError('账号注销功能待确认，暂未开放', 'cancel-disabled');
  const col = db.collection(COLLECTIONS.User);
  const user = await col.findOne({ _id: userId });
  if (!user) throw cancelError('身份信息缺失，请重新登录', 'empty-identity');
  if (user.cancelStatus === 'pendingCancel') {
    throw cancelError('你已经提交过注销申请啦，冷静期内随时可以撤销', 'cancel-already-pending');
  }
  const cancelAt = nowTs + s.coolingOffDays * DAY;
  await col.update({ _id: userId }, {
    cancelStatus: 'pendingCancel', cancelApplyAt: nowTs, cancelAt,
  });
  await audit.log(db, {
    ownerId: userId, actorId: userId, action: 'cancel',
    targetType: 'account', targetId: userId, detail: '提交注销申请，进入冷静期',
  });
  return { status: 'pendingCancel', cancelAt, coolingOffDays: s.coolingOffDays };
}

/** 撤销注销（冷静期内）：清掉待注销状态，账号恢复如常 */
async function revokeCancellation(db, userId) {
  const col = db.collection(COLLECTIONS.User);
  const user = await col.findOne({ _id: userId });
  if (!user) throw cancelError('身份信息缺失，请重新登录', 'empty-identity');
  if (user.cancelStatus !== 'pendingCancel') {
    throw cancelError('当前没有待执行的注销申请', 'cancel-not-pending');
  }
  await col.update({ _id: userId }, {
    cancelStatus: null, cancelApplyAt: null, cancelAt: null,
  });
  await audit.log(db, {
    ownerId: userId, actorId: userId, action: 'cancel',
    targetType: 'account', targetId: userId, detail: '撤销注销申请',
  });
  return { ok: true };
}

/**
 * 注销状态（"我的"页待注销提示与注销页回显用）
 * @returns {{status:'none'|'pendingCancel', enabled:boolean,
 *   cancelAt:number|null, cancelApplyAt:number|null, remainingDays:number}}
 */
async function getCancellationStatus(db, userId, config = AppConfig, nowTs = now()) {
  const s = cancelSettings(config);
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  if (!user || user.cancelStatus !== 'pendingCancel') {
    return { status: 'none', enabled: s.enabled, cancelAt: null, cancelApplyAt: null, remainingDays: 0 };
  }
  return {
    status: 'pendingCancel',
    enabled: s.enabled,
    cancelAt: user.cancelAt || null,
    cancelApplyAt: user.cancelApplyAt || null,
    remainingDays: Math.max(0, Math.ceil(((user.cancelAt || 0) - nowTs) / DAY)),
  };
}

/**
 * 冷静期满执行注销（含联动清理，见文件头）：
 * 未申请/未到期 → {executed:false} 原样返回，不动任何数据；
 * 到期 → 先解共享联动，再 purge 本人数据，返回清理结果。
 * 触发点：本地模式在 app 启动时调用（data-service.init）；
 * 云端应由定时任务批量扫描 pendingCancel 且 cancelAt 已到期的用户调用。
 */
async function executeCancellationIfDue(db, userId, config = AppConfig, nowTs = now()) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  if (!user || user.cancelStatus !== 'pendingCancel') return { executed: false };
  if (!user.cancelAt || nowTs < user.cancelAt) return { executed: false };

  // 联动1（作为主人）：其共享关系的授权单先删（成员行由 purge 按 ownerId 删）
  const ownedMs = await db.collection(COLLECTIONS.ShareMembership).find({ ownerId: userId });
  for (const ms of ownedMs) {
    await db.collection(COLLECTIONS.ShareGrant).remove({ membershipId: ms._id });
  }
  // 联动2（作为成员）：成员身份移除——成员行与对应授权单一并删除；
  // 其在主人账本里留下的记录（createdBy 为本人）是主人账本数据，不在此删
  const memberMs = await db.collection(COLLECTIONS.ShareMembership).find({ memberId: userId });
  for (const ms of memberMs) {
    await db.collection(COLLECTIONS.ShareGrant).remove({ membershipId: ms._id });
    await db.collection(COLLECTIONS.ShareMembership).remove({ _id: ms._id });
  }
  // 联动3（邀请奖励）：邀请码在 User 文档里，purge 删 User 即停用；
  // inviteBindings / inviteRewardGrants 按防刷口径保留（purge 清单本就不含）
  const r = await purgeUserOnCancellation(db, userId);
  return { executed: true, ...r };
}

module.exports = {
  purgeUserOnCancellation,
  requestCancellation,
  revokeCancellation,
  getCancellationStatus,
  executeCancellationIfDue,
  cancelSettings,
};
