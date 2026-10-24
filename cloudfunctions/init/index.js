/**
 * 礼单簿 · 云环境初始化脚本（一次性）
 *
 * 用途：新云环境第一次部署时，建齐 17 个集合 + 写入默认 appConfig。
 * 用法（详见同目录 README.md）：
 *   1. 在微信开发者工具里把本目录作为云函数上传部署；
 *   2. 在云开发控制台「云函数 → init → 云端测试」里调用一次（入参 {}）；
 *   3. 确认返回 ok 后，按 README 把管理员 openid 填进 appConfig.adminIds；
 *   4. 初始化完成后，把本云函数删掉或从环境里下线，避免被重复调用。
 *
 * 安全：
 * - 本函数只做「建空集合 + 写默认配置」，不读、不删任何业务数据；
 * - appConfig 已存在时会跳过配置写入（不覆盖老板平台后续改过的值），
 *   只补建缺失的集合；确需强制重写配置时，调用时传 { forceConfig: true }。
 * - adminIds 默认写空数组：空名单 = 无人是管理员（core/admin.js 是 fail closed），
 *   不会因为忘了填而放行任何人。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 17 个集合（与 core/models.js 的 COLLECTIONS 一一对应，名字一字不差；
 * 2026-10-21 自制请柬下线删 invitations/rsvps，并补上此前漏列的 pointsLedger） */
const COLLECTIONS = [
  'users',
  'contacts',
  'receiveEvents',
  'receiveRecords',
  'giftRecords',
  'shareMemberships',
  'shareGrants',
  'auditLogs',
  'importJobs',
  'exportJobs',
  'appConfig',
  'inviteBindings',     // 邀请绑定（防重复绑定，注销不删）
  'inviteRewardGrants', // 邀请奖励发放记录（额度的唯一真源）
  'orders',             // 会员购买订单（支付适配层；回调验签+金额比对后才发货）
  'pointsLedger',       // 积分流水（余额对账真源）
  'notifications',      // 站内通知（会员提醒/奖励到账/共享变更）
  'feedbacks',          // 意见反馈（老板平台反馈列表读此集合）
];

/** 默认 appConfig（与 miniprogram/config/app-config.js 的静态默认保持一致） */
function defaultConfig(now) {
  return {
    // 注意：不要在这里写 _id —— doc('singleton').set() 的 data 里带 _id 会被
    // 云数据库拒绝（-501007 不能更新_id的值，2026-10-22 云端首跑实测），文档 ID 由 doc() 指定即可。
    // ⚠️ 管理员初始化：把创始人自己的 openid 填进这个数组（获取方法见 README），
    // 只有名单里的人能进老板平台、能改配置。先空着上线 = 老板平台无人可用，安全。
    adminIds: [],
    freeQuota: {
      receiveEvents: 3,     // 免费：收礼礼薄 3 个
      recordsPerEvent: 50,  // 免费：每个礼薄 50 条（2026-10-24 用户改定）
      giftRecords: 50,      // 免费：送礼 50 条（2026-10-24 用户改定）
      contacts: 50,         // 免费：亲友 50 人
    },
    membership: {
      // 会员额度为占位结构，定价时与价格档位一起定，不要当成已定数字
      quota: {
        receiveEvents: 30,
        recordsPerEvent: 500,
        giftRecords: 500,
        contacts: 500,
      },
      expiry: {
        gracePeriodDays: 30,        // 缓冲期 30 天（已定）
        reminders: [15, 0, -1],     // 到期前15天 / 到期当天 / 缓冲期结束前
        overQuotaReadonly: true,    // 超额记录只读
      },
    },
    memberOnlyFeatures: ['familyShareInvite', 'photoImport', 'landscapeMode'],
    inviteReward: {
      enabled: true, // 邀请得名额默认开启（老板平台可关停）
      perInvite: { receivePool: 10, giftRecords: 5 }, // 每次成功邀请：收礼池 +10、送礼 +5
      maxSuccessfulInvites: 10, // 每个邀请人最多计入 10 次（现行口径）
    },
    updatedAt: now,
  };
}

exports.main = async (event = {}) => {
  const now = Date.now();
  const result = { ok: true, createdCollections: [], skippedCollections: [], config: '' };

  // 1) 建集合（已存在的会报错，捕获后记为跳过，可安全重复执行）
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      result.createdCollections.push(name);
    } catch (e) {
      result.skippedCollections.push(name);
    }
  }

  // 2) 写默认 appConfig（不存在才写；除非 forceConfig）
  const cfgRef = db.collection('appConfig').doc('singleton');
  let exists = false;
  try {
    const got = await cfgRef.get();
    exists = !!(got && got.data);
  } catch (e) {
    exists = false;
  }
  if (!exists || event.forceConfig === true) {
    await cfgRef.set({ data: defaultConfig(now) });
    result.config = exists ? 'overwritten(forceConfig)' : 'created';
  } else {
    result.config = 'skipped-exists';
  }

  result.nextSteps = [
    '到数据库 appConfig 集合，把创始人 openid 填进 singleton 文档的 adminIds 数组',
    '按 docs/云联调准备.md 继续：权限规则、云存储、部署 api 云函数',
    '初始化完成后删除或下线 init 云函数',
  ];
  return result;
};
