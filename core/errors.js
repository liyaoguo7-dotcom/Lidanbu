/**
 * 礼单簿 · 用户可读错误（补强）
 *
 * 对外返回的拒绝原因不得带内部开关名（如 del/export/view），
 * 统一转换为用户可读提示。机器可读的原因码放在 err.code。
 */

const MESSAGES = {
  // —— 权限类 ——
  'empty-identity': '身份信息缺失，请重新登录',
  'not-admin': '需要管理员身份',
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
  // —— 额度类（v3.1 第0章第17条：委婉"卖惨"文案，不报剩余数） ——
  'quota-exceeded:event': '呜呜，本小本本快被塞满啦！礼薄本子已经写满了，开个会员可以添更多本子哦～',
  'quota-exceeded:receiveRecord': '呜呜，本小本本快被塞满啦！这本礼薄已经记满了，开个会员可以记更多笔哦～',
  'quota-exceeded:receivePool': '呜呜，本小本本快被塞满啦！收礼名额已经用完啦，开个会员可以记更多笔哦～',
  'quota-exceeded:gift': '呜呜，本小本本快被塞满啦！送礼记录已经记满了，开个会员可以记更多笔哦～',
  'quota-exceeded:contact': '呜呜，本小本本快被塞满啦！亲友已经记满啦，开个会员可以添更多亲友哦～',
  'readonly:over-free-quota-after-expiry': '会员已到期，该记录为只读',
  // —— 邀请奖励类（口径：邀请是自愿的，不出现强制/诱导分享措辞） ——
  'invite-disabled': '邀请奖励活动暂未开启',
  'invite-code-invalid': '邀请码不正确，请检查后再试',
  'invite-self': '不能填写自己的邀请码哦',
  'invite-already-bound': '你已经绑定过邀请啦，不能重复绑定',
  'invite-not-new-user': '邀请奖励只面向新用户哦',
  'invite-condition-incomplete': '还差一点：新建 1 个礼薄并记 1 条收礼，或记 1 条送礼，就能为邀请人点亮奖励',
  'invite-cap-reached': '邀请人的奖励名额已达上限',
  'invite-device-duplicate': '这台设备已经参与过邀请奖励啦',
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

/** 邀请奖励拒绝：消息为用户可读提示，err.code 为内部原因码 */
function inviteDenied(reason) {
  const e = new Error(userMessage(reason));
  e.code = reason;
  return e;
}

module.exports = { userMessage, permDenied, quotaDenied, memberRequired, inviteDenied, MESSAGES };
