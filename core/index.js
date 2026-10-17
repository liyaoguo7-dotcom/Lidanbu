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
  contacts: require('./contacts'),
  receive: require('./receive'),
  gifts: require('./gifts'),
  stats: require('./stats'),
  share: require('./share'),
  config: require('../miniprogram/config/app-config'),
};
