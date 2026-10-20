/**
* 礼单簿 · 云函数 api（T1.x 薄封装，待联调）
*
* 云环境到位后联调。action 分发到 core/ 对应模块；
* 部署时把 core/ 与 miniprogram/config/app-config.js 一并打包进云函数目录。
*
* 本地 Node 无法运行，需云环境。
*
* 已就绪的真实路由模块（依赖注入，可在本地单测）：
* - 导出 xlsx：./routes-export.js 的 createExportXlsxHandler({ db, buildXlsx })
*   action='exportXlsx' 时调用，actorId 取 cloud.getWXContext().OPENID；
*   测试见 tests/test-cloud-export.js。
*/

// const cloud = require('wx-server-sdk');
// cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV});
// const core = require('./core'); // 部署时复制 core/ 到本目录
// const db = new core.db.CloudDB();

/**
* 云函数入口（示意，待联调）
* event: {action, actorId, params}
*/
// exports.main = async (event) => {
// const { action, actorId, params} = event;
// const { authz, contacts, receive, gifts, stats, share, quota, audit} = core;
// switch (action) {
// //...按 docs/接口文档.md 分发...
// default: return { ok: false, reason: `未知action:${action}`};
//}
//};

module.exports = {};
