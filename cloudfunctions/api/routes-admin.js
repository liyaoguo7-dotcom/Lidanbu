/**
* 礼单簿 · 老板平台云函数路由（阶段5 骨架，待云联调）
*
* 老板平台只看统计数字和会员状态。
* 任何接口/页面/导出都不得返回用户的礼金、联系人、备注内容，
* 也不能替用户导出账本。
* 本文件只是 core/admin.js 的薄封装：参数透传、结果原样返回，
* 不做任何字段增删——字段白名单由 core/admin.js 强制执行。
*
* 待联调事项：
* 1. 管理员身份校验 + 二次验证（上线前必须有）；
* 2. 所有配置修改写操作记录（setMemberPlan 与配置写接口均已在 core 内写 audit）；
* 3. 部署时把 core/ 与 miniprogram/config/app-config.js 一并打包进云函数目录。
*/

// const cloud = require('wx-server-sdk');
// cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV});
// const core = require('./core'); // 部署时复制 core/ 到本目录
// const db = new core.db.CloudDB();

/**
* 管理员 action 分发（示意，待联调）
* event: { action: 'admin.xxx', actorId(管理员), params}
*/
// const ADMIN_ACTIONS = {
// 'admin.overview': (db, params) => core.admin.overview(db),
// 'admin.memberList': (db, params) => core.admin.memberList(db, params),
// 'admin.setMemberPlan': (db, params) =>
// core.admin.setMemberPlan(db, params.userId, params.plan, params.days),
// 'admin.quotaUsage': (db, params) => core.admin.quotaUsage(db, params.userId),
// 'admin.inviteStats': (db) => core.admin.inviteStats(db),
// 'admin.shareOverview': (db, params) => core.admin.shareOverview(db, params),
// // 配置管理（core 内 requireAdmin 校验 actorId 须在 appConfig.adminIds 名单内）：
// 'admin.getConfig': (db, params, actorId) => core.admin.getConfig(db, actorId),
// 'admin.updatePricing': (db, params, actorId) => core.admin.updatePricing(db, actorId, params.plans),
// 'admin.updateFeatureSwitches': (db, params, actorId) => core.admin.updateFeatureSwitches(db, actorId, params.features),
// 'admin.updateMemberOnlyFeatures': (db, params, actorId) => core.admin.updateMemberOnlyFeatures(db, actorId, params.features),
// 'admin.updateQuotaSettings': (db, params, actorId) => core.admin.updateQuotaSettings(db, actorId, params),
// 'admin.updateInviteSettings': (db, params, actorId) => core.admin.updateInviteSettings(db, actorId, params),
// // 任务M 补全项（core 内一律 requireAdmin）：
// 'admin.searchAccounts': (db, params, actorId) => core.admin.searchAccounts(db, actorId, params),
// 'admin.importUsage': (db, params, actorId) => core.admin.importUsage(db, actorId, params),
// 'admin.feedbackList': (db, params, actorId) => core.admin.feedbackList(db, actorId, params),
// 'admin.feedbackSetStatus': (db, params, actorId) => core.admin.feedbackSetStatus(db, actorId, params.feedbackId, params.status),
// 'admin.orderList': (db, params, actorId) => core.admin.orderList(db, actorId, params),
// 'admin.orderStats': (db, params, actorId) => core.admin.orderStats(db, actorId),
// 'admin.listAdmins': (db, params, actorId) => core.admin.listAdmins(db, actorId),
// 'admin.auditTrail': (db, params, actorId) => core.admin.auditTrail(db, actorId, params),
// 'admin.setUserRestricted': (db, params, actorId) => core.admin.setUserRestricted(db, actorId, params.userId, params),
//};
//
// exports.main = async (event) => {
// // TODO(待联调): 校验 actorId 为管理员身份 + 二次验证，未通过直接拒绝
// const { action, params} = event;
// const fn = ADMIN_ACTIONS[action];
// if (!fn) return { ok: false, reason: `未知action:${action}`};
// try {
// const data = await fn(db, params || {});
// return { ok: true, data};
//} catch (e) {
// return { ok: false, reason: e.message};
//}
//};

module.exports = {};
