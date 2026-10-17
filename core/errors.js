/**
 * 礼单簿 · 用户可读错误（补强）
 *
 * 对外返回的拒绝原因不得带内部开关名（如 del/export/view），
 * 统一转换为用户可读提示。机器可读的原因码放在 err.code。
 */

const MESSAGES = {
  // —— 权限类 ——
  'empty-identity': '身份信息缺失，请重新登录',
  'no-active-membership': '无权访问该账本',
  'switch-off:view': '无权查看',
  'switch-off:add': '无权新增',
  'switch-off:edit': '无权修改',
  'switch-off:del': '无权删除',
  'switch-off:export': '无权导出',
  'out-of-scope:gifts': '超出授权范围',
  'out-of-scope:event': '超出授权范围',
  'out-of-scope:contact': '超出授权范围',
  'member-cannot-touch-owner-contacts': '无权操作账本主人的亲友录',
  'sharing-paused': '共享已暂停：账本主人会员已过期，续费后自动恢复',
  'grace-readonly': '账本主人会员已到期，共享当前为只读',
  // —— 额度类 ——
  'quota-exceeded:event': '礼薄数量已达上限',
  'quota-exceeded:receiveRecord': '该礼薄记录数已达上限',
  'quota-exceeded:receivePool': '收礼额度已用完',
  'quota-exceeded:gift': '送礼记录数已达上限',
  'quota-exceeded:contact': '联系人数已达上限',
  'readonly:over-free-quota-after-expiry': '会员已到期，该记录为只读',
};

function userMessage(reason) {
  return MESSAGES[reason] || '操作被拒绝';
}

/** 权限拒绝：消息"无权限：xxx"，err.code 为内部原因码 */
function permDenied(reason) {
  const e = new Error(`无权限：${userMessage(reason)}`);
  e.code = reason;
  return e;
}

/** 额度/只读拒绝：消息为用户可读提示，err.code 为内部原因码 */
function quotaDenied(reason) {
  const e = new Error(userMessage(reason));
  e.code = reason;
  return e;
}

/** 会员专属功能门禁：与"无权限"区分的独立类型 */
function memberRequired(featureLabel) {
  const e = new Error(`需要开通会员：${featureLabel}`);
  e.code = 'member-required';
  return e;
}

module.exports = { userMessage, permDenied, quotaDenied, memberRequired, MESSAGES };
