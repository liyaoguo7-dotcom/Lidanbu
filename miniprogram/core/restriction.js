/**
 * 礼单簿 · 异常用户限制（老板平台第11项的拦截点）
 *
 * 管理员在老板平台给用户打 restricted 标记后，该用户在核心写入口
 * 一律被拒（只拦写、不拦读）：记账（亲友/礼薄/收送记录）、家庭共享、
 * 拍照导入任务与确认写入都走 assertWritable。
 * 标记存在 User 文档：restricted: { status:true, reason, by, at }。
 * 未打标记（字段缺失/status 非 true）一律放行，老数据零影响。
 */
const { COLLECTIONS } = require('./models');
const errors = require('./errors');

/** 用户是否处于受限状态（用户不存在按不受限处理，由后续校验报错） */
async function isRestricted(db, userId) {
  if (!userId) return false;
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  return !!(user && user.restricted && user.restricted.status === true);
}

/** 写操作拦截点：受限用户抛 permDenied('user-restricted') */
async function assertWritable(db, actorId) {
  if (await isRestricted(db, actorId)) {
    throw errors.permDenied('user-restricted');
  }
}

module.exports = { isRestricted, assertWritable };
