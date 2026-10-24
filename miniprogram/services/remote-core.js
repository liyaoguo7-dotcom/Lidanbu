/**
 * 礼单簿 · 远程 core 代理（任务AD 切云）
 *
 * 与 core/ 同形的模块对象：data-service 在云模式（localMode=false）下
 * 用它替换本地 core，全部业务调用经 wx.cloud.callFunction 走云函数 api，
 * 服务端用同一套 core 执行业务（权限/额度/金额规则只有一份，在服务端）。
 *
 * 约定（与 cloudfunctions/api 分发一致）：
 * - 每个函数本地签名 fn(db, userId, ...rest)，远程实现忽略前两参，
 *   调 callFunction({ name:'api', data:{ action:'<模块>.<函数>', args: rest } })；
 * - 信封 { ok:true, data } → 返回 data；{ ok:false, error, code? } →
 *   throw Error(error 文案) 并还原 err.code（服务端错误文案即用户可读文案，
 *   data-service 的 friendly() 口径不变）；
 * - callFunction 本身失败（无云/断网/超时）→ throw 带 errMsg 的网络错误，
 *   由 data-service.isNetworkError 识别为网络文案。
 *
 * models 与 format 是本地常量/纯函数，**绝不走 RPC**：本对象直接挂
 * 本地 core 的引用，data-service 的 core.models / core.format 调用点
 * 在云模式下命中的仍是本地实现。
 *
 * 函数清单以 data-service.js 实际调用点为准（任务AD 全量核对）；
 * data-service 不调用的函数不进本清单（如 users.attachCreatorNames 的
 * 签名 (db, records) 与分发约定不符，补名逻辑已收进 gifts.getGift /
 * receive.getRecord 的服务端实现里）。
 */
const localCore = require('../core/index.js');

/**
 * 默认传输：wx.cloud.callFunction。返回 res.result（服务端信封）。
 * 测试可注入自定义传输（进程内回环到 cloudfunctions/api 的 createMain）。
 */
async function defaultTransport(data) {
  const cloud = (typeof wx !== 'undefined') ? wx.cloud : null;
  if (!cloud || typeof cloud.callFunction !== 'function') {
    const e = new Error('callFunction:fail 云服务不可用');
    e.errMsg = 'callFunction:fail cloud not ready';
    throw e;
  }
  const res = await cloud.callFunction({ name: 'api', data });
  return res && res.result;
}

/**
 * 建一个远程函数：moduleFn('contacts', 'createContact') 的本地形状为
 * async (db, userId, ...rest)；远程只把 rest 作为 args 发出。
 */
function makeRemoteFn(transport, modName, fnName) {
  return async function remoteFn(db, userId, ...rest) {
    const envelope = await transport({ action: `${modName}.${fnName}`, args: rest });
    if (!envelope || envelope.ok !== true) {
      const err = new Error((envelope && envelope.error) || '操作失败，请重试');
      if (envelope && typeof envelope.code === 'string') err.code = envelope.code;
      throw err;
    }
    return envelope.data;
  };
}

function makeRemoteModule(transport, modName, fnNames) {
  const mod = {};
  for (const fnName of fnNames) mod[fnName] = makeRemoteFn(transport, modName, fnName);
  return mod;
}

/**
 * @param {(data:{action:string, args?:Array}) => Promise<object>} [transport]
 *   缺省用 wx.cloud.callFunction；测试注入回环传输。
 * @returns 与 core 同形的模块对象（models/format 为本地引用）
 */
function createRemoteCore(transport) {
  const t = transport || defaultTransport;
  return {
    // 本地常量/纯函数（不走 RPC）
    models: localCore.models,
    format: localCore.format,
    config: localCore.config,

    contacts: makeRemoteModule(t, 'contacts', [
      'createContact', 'updateContact', 'deleteContact',
      'listContacts', 'searchContacts', 'getContact',
    ]),
    receive: makeRemoteModule(t, 'receive', [
      'createEvent', 'updateEvent', 'deleteEvent', 'listEvents', 'listEventSummaries', 'getEvent',
      'createRecord', 'updateRecord', 'deleteRecord', 'listRecords', 'getRecord', 'getEventDetail', 'getRecordDetail',
    ]),
    gifts: makeRemoteModule(t, 'gifts', [
      'createGift', 'updateGift', 'deleteGift', 'listGifts', 'getGift', 'getGiftDetail',
    ]),
    stats: Object.assign(makeRemoteModule(t, 'stats', [
      'contactStats', 'memberStats', 'memberTimeline', 'memberEvents', 'getHomeData', 'wanglaiList',
    ]), {
      // 纯函数（只算范围，不碰数据）：本地实现，绝不走 RPC
      resolveRangeOpt: localCore.stats.resolveRangeOpt,
    }),
    share: makeRemoteModule(t, 'share', [
      'invite', 'accept', 'updateGrant', 'removeMember', 'listMembers',
      'getGrant', 'getMembership', 'listReceived', 'getMyGrantFor',
    ]),
    quota: Object.assign(makeRemoteModule(t, 'quota', [
      'resolveInviteSettings', 'computePoolUsed',
    ]), {
      // 纯函数（只吃用户文档+配置算状态/额度/提醒）：本地实现，绝不走 RPC；
      // 云模式下用户文档经 users.getSelf 从服务端取回后在本地算，与本地口径一致
      getMembershipState: localCore.quota.getMembershipState,
      getEffectiveQuota: localCore.quota.getEffectiveQuota,
      getReminderSchedule: localCore.quota.getReminderSchedule,
    }),
    inviteReward: makeRemoteModule(t, 'inviteReward', [
      'countSuccessfulInvites', 'evaluateInvite', 'bindInvite', 'getMyInviteSummary',
    ]),
    payment: Object.assign(makeRemoteModule(t, 'payment', [
      'resolvePricing', 'purchase', 'purchasePointsPack', 'listOrders', 'getPaymentPlatforms',
    ]), {
      // 纯函数（只吃配置+平台名）：本地实现，绝不走 RPC
      resolvePlatformPurchaseEnabled: localCore.payment.resolvePlatformPurchaseEnabled,
    }),
    points: makeRemoteModule(t, 'points', [
      'getBalance', 'listLedger', 'resolvePointsSettings',
    ]),
    admin: makeRemoteModule(t, 'admin', [
      'overview', 'memberList', 'setMemberPlan', 'quotaUsage', 'inviteStats', 'shareOverview',
      'searchAccounts', 'importUsage', 'feedbackList', 'feedbackSetStatus',
      'orderList', 'orderStats', 'listAdmins', 'addAdmin', 'removeAdmin', 'auditTrail', 'setUserRestricted',
      'getConfig', 'updatePricing', 'updateFeatureSwitches', 'updateMemberOnlyFeatures',
      'updateQuotaSettings', 'updateInviteSettings', 'updatePointsSettings',
      'updatePaymentPlatforms', 'updateLaunchSwitches', 'isAdmin',
    ]),
    restriction: makeRemoteModule(t, 'restriction', [
      'isRestricted', 'assertWritable',
    ]),
    users: Object.assign(makeRemoteModule(t, 'users', [
      'getProfile', 'getSelf', 'updateProfile', 'getPrivacyConsent', 'setPrivacyConsent',
    ]), {
      // 纯函数（用户文档 → 显示名）：本地实现，绝不走 RPC
      displayName: localCore.users.displayName,
    }),
    account: makeRemoteModule(t, 'account', [
      'requestCancellation', 'revokeCancellation', 'getCancellationStatus',
    ]),
    notify: makeRemoteModule(t, 'notify', [
      'listNotifications', 'unreadCount', 'markRead', 'markAllRead', 'checkMembershipReminders',
    ]),
    feedback: makeRemoteModule(t, 'feedback', [
      'submitFeedback', 'listMyFeedback',
    ]),
    features: makeRemoteModule(t, 'features', [
      'getFlags',
    ]),
    importer: makeRemoteModule(t, 'importer', [
      'startImportTask', 'writeImport', 'recordExportJob', 'listExportJobs',
    ]),
    export: makeRemoteModule(t, 'export', [
      'buildExportData',
    ]),

    /** whoami：取服务端认定的 openid（init 云流程用；非模块函数，单独暴露） */
    async whoami() {
      const envelope = await t({ action: 'whoami' });
      if (!envelope || envelope.ok !== true) {
        const err = new Error((envelope && envelope.error) || '操作失败，请重试');
        if (envelope && typeof envelope.code === 'string') err.code = envelope.code;
        throw err;
      }
      return envelope.data;
    },
  };
}

module.exports = { createRemoteCore, defaultTransport };
