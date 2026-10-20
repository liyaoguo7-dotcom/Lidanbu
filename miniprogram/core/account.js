/**
 * 礼单簿 · 账号注销（阶段3）
 *
 * ⚠️ 待用户确认，确认前不上线。
 * 数据策略（阶段1预留设计）：删除该用户全部账本数据；审计日志仅保留
 * 不含金额和姓名的流水（action/targetType/时间，detail 已脱敏）。
 */
const { COLLECTIONS } = require('./models');

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

module.exports = { purgeUserOnCancellation };
