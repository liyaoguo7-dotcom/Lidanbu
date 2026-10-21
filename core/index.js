/**
 * 礼单簿 · 核心业务逻辑统一出口（阶段1）
 * 纯 JS，无微信依赖；本地用 MemoryDB 测试，云端用 CloudDB 联调。
 */
module.exports = {
  db: {
    MemoryDB: require('./db-memory').MemoryDB,
    CloudDB: require('./db-cloud').CloudDB, // 待联调
  },
  models: require('./models'),
  authz: require('./authz'),
  quota: require('./quota'),
  audit: require('./audit'),
  export: require('./export'),
  format: require('./format'),
  contacts: require('./contacts'),
  receive: require('./receive'),
  gifts: require('./gifts'),
  stats: require('./stats'),
  share: require('./share'),
  inviteReward: require('./invite-reward'), // 邀请得名额（绑定/发放/汇总）
  payment: require('./payment'), // 支付与会员订单（适配层+模拟支付，高风险）
  payAdapter: require('./pay-adapter'), // 支付适配层（Mock / 微信虚拟支付骨架）
  invitation: require('./invitation'), // 电子请柬 + 回执（阶段4）
  invitationStyles: require('./invitation-styles'), // 请柬 4 种风格常量（页面与效果图共用口径）
  admin: require('./admin'), // 老板平台聚合接口（15项全真接口，只返回数字与会员状态）
  restriction: require('./restriction'), // 异常用户限制标记与写入口拦截点
  ocr: require('./ocr-adapter'), // 拍照导入 OCR 适配层（本轮仅 Mock，纯 JS 无微信依赖）
  importer: require('./import'), // 拍照导入确认写入（纯 JS 无微信依赖）
  account: require('./account'), // 账号注销（⚠️ 待用户确认，确认前不上线）
  notify: require('./notify'), // 通知中心（站内通知 + 订阅消息适配骨架，任务L）
  feedback: require('./feedback'), // 意见反馈（用户提交 + 老板平台列表，任务L）
  config: require('../miniprogram/config/app-config'),
};
