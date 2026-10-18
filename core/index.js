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
  admin: require('./admin'), // 老板平台聚合接口（阶段5骨架，只返回数字与会员状态）
  ocr: require('./ocr-adapter'), // 拍照导入 OCR 适配层（本轮仅 Mock，纯 JS 无微信依赖）
  importer: require('./import'), // 拍照导入确认写入（纯 JS 无微信依赖）
  account: require('./account'), // 账号注销（⚠️ 待用户确认，确认前不上线）
  config: require('../miniprogram/config/app-config'),
};
