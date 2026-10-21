/**
 * 礼单簿 · 通知中心（任务L）
 *
 * 统一入口：notify(db, userId, type, payload) —— 与全仓 core 约定一致，
 * db 为第一个参数；其余三元组 (userId, type, payload) 即对外约定签名。
 *
 * 发送通道（适配层，页面与触发点只调 notify，不感知通道）：
 * - 站内通知：本轮已实现——写一条 Notification 记录，"我的—通知"页读取，
 *   未读数走 unreadCount；这条记录本身就是站内通道的送达凭证。
 * - 订阅消息：骨架——模板 ID 在 AppConfig.notify.subscribeTemplates 按
 *   type 配置（现为空占位）；云联调时在此处补真实发送（需用户订阅授权
 *   与服务端发送接口），模板未配置/未联调时静默跳过，绝不影响站内通知。
 *
 * 通知类型：
 * - membershipExpiring  会员到期前 15 天（payload: {expireAt}）
 * - membershipExpired   会员到期当天（payload: {expireAt}）
 * - graceEnding         缓冲期结束前（payload: {expireAt, graceUntil}）
 * - inviteRewardGranted 邀请奖励到账（payload: {poolGranted, giftsGranted, grantId?}）
 * - shareChanged        家庭共享变更（payload: {action:
 *     'inviteAccepted'（通知主人）|'grantUpdated'（通知成员）|'memberRemoved'（通知被移除成员）}）
 *
 * 会员三提醒的"何时发"由 checkMembershipReminders 按 quota.getReminderSchedule
 * 判定并以 dedupeKey 去重（同一到期日同一提醒只发一次）；生产环境应由云端
 * 定时任务调用它，本地/页面侧在打开通知页与"我的"页时顺带调用（见 data-service）。
 */
const { COLLECTIONS, now } = require('./models');
const AppConfig = require('../config/app-config');
const quota = require('./quota');

const TYPES = [
  'membershipExpiring',
  'membershipExpired',
  'graceEnding',
  'inviteRewardGranted',
  'shareChanged',
];

/** 时间戳 → "2026年11月5日"（core 内禁用 toLocaleString，手写拼装） */
function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 按类型与载荷生成用户可读文案（大白话，不出现内部字段名） */
function buildContent(type, payload = {}) {
  const graceDays = (AppConfig.membership.expiry || {}).gracePeriodDays || 30;
  switch (type) {
    case 'membershipExpiring':
      return {
        title: '会员快到期啦',
        body: `你的会员将在${payload.expireAt ? ymd(payload.expireAt) : '近期'}到期。续费后，横置礼单本、拍照导入这些会员功能就能继续用啦。`,
      };
    case 'membershipExpired':
      return {
        title: '会员已到期',
        body: `你的会员已经到期啦。别担心，接下来 ${graceDays} 天是缓冲期，账本照样能看；续费后一切恢复如初。`,
      };
    case 'graceEnding':
      return {
        title: '缓冲期快结束啦',
        body: `会员缓冲期将在${payload.graceUntil ? ymd(payload.graceUntil) : '近期'}结束。结束后，超出免费额度的记录只能看、不能改；续费即可全部恢复。`,
      };
    case 'inviteRewardGranted':
      return {
        title: '邀请奖励到账啦',
        body: `一位新朋友开始用礼单簿记账啦，你得到收礼名额 +${payload.poolGranted || 0}、送礼名额 +${payload.giftsGranted || 0}，已经加进你的额度里，去「邀请好友得名额」页可以查看。`,
      };
    case 'shareChanged':
      if (payload.action === 'inviteAccepted') {
        return {
          title: '家人加入了共享账本',
          body: '一位家人接受了你的共享邀请，已经可以按你设定的权限查看账本啦。',
        };
      }
      if (payload.action === 'grantUpdated') {
        return {
          title: '共享权限有变化',
          body: '账本主人调整了共享给你的内容或权限，打开「家庭共享」可以查看最新设置。',
        };
      }
      if (payload.action === 'memberRemoved') {
        return {
          title: '你已被移出共享',
          body: '账本主人已将你移出这个账本的共享，你将不能再查看这个账本；你自己的账本不受影响。',
        };
      }
      return {
        title: '家庭共享有变化',
        body: '家庭共享的设置有变化，打开「家庭共享」可以查看最新情况。',
      };
    default:
      throw new Error(`未知通知类型:${type}`);
  }
}

/**
 * 订阅消息通道（骨架，待云联调）：
 * 模板 ID 未配置 → 跳过；已配置但发送通道未联调 → 仍跳过并注明原因。
 * 云联调落地时只改这里：取 AppConfig.notify.subscribeTemplates[type]，
 * 经云函数/服务端接口调用订阅消息发送（需用户通过订阅授权），
 * 入参用 record 的 title/body 映射模板字段。
 */
async function sendSubscribe(db, userId, type, record) {
  const templates = (AppConfig.notify && AppConfig.notify.subscribeTemplates) || {};
  const templateId = templates[type];
  if (!templateId) return { sent: false, reason: 'template-not-configured' };
  return { sent: false, reason: 'pending-cloud-integration' };
}

/**
 * 发一条通知（站内落库 + 订阅消息骨架尝试）。
 * payload.dedupeKey 存在时先查同键记录，已发过则不重复写（幂等）。
 * @returns {{created:boolean, notification:object}}
 */
async function notify(db, userId, type, payload = {}) {
  if (!userId) throw new Error('身份信息缺失，请重新登录');
  if (!TYPES.includes(type)) throw new Error(`未知通知类型:${type}`);
  const col = db.collection(COLLECTIONS.Notification);
  if (payload.dedupeKey) {
    const existed = await col.findOne({ userId, dedupeKey: payload.dedupeKey });
    if (existed) return { created: false, notification: existed };
  }
  const { title, body } = buildContent(type, payload);
  const doc = { userId, type, title, body, read: false, createdAt: now() };
  if (payload.dedupeKey) doc.dedupeKey = payload.dedupeKey;
  const { _id } = await col.insert(doc);
  const record = { ...doc, _id };
  // 订阅消息为附加通道：失败/未配置都不影响站内通知已落库
  try { await sendSubscribe(db, userId, type, record); } catch (e) { /* 忽略 */ }
  return { created: true, notification: record };
}

/** 我的通知列表（最新在上） */
async function listNotifications(db, userId, { limit = 50 } = {}) {
  return db.collection(COLLECTIONS.Notification)
    .find({ userId }, { sort: { createdAt: -1 }, limit });
}

/** 未读数（"我的"页红点用） */
async function unreadCount(db, userId) {
  return db.collection(COLLECTIONS.Notification).count({ userId, read: false });
}

/** 标一条已读：只能标自己的（查询带 userId，他人的标不动） */
async function markRead(db, userId, notificationId) {
  const r = await db.collection(COLLECTIONS.Notification)
    .update({ _id: notificationId, userId }, { read: true });
  return { ok: (r.updated || 0) > 0 };
}

/** 全部标已读 */
async function markAllRead(db, userId) {
  const r = await db.collection(COLLECTIONS.Notification)
    .update({ userId, read: false }, { read: true });
  return { updated: r.updated || 0 };
}

/**
 * 会员三提醒触发判定：按 quota.getReminderSchedule 的三个时间点，
 * 到点且未发过（dedupeKey=类型+到期日）才发。返回本次新发的类型数组。
 * 触发点：data-service 在打开通知页/"我的"页刷新时调用；上云后改云端定时任务。
 */
async function checkMembershipReminders(db, userId, nowTs = now()) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  if (!user || !user.membership || !user.membership.expireAt) return { fired: [] };
  const schedule = quota.getReminderSchedule(user);
  if (!schedule.length) return { fired: [] };
  const day = 86400e3;
  const graceUntil = user.membership.expireAt
    + ((AppConfig.membership.expiry || {}).gracePeriodDays || 30) * day;
  const plan = [
    { type: 'membershipExpiring', at: schedule[0] },
    { type: 'membershipExpired', at: schedule[1] },
    { type: 'graceEnding', at: schedule[2] },
  ];
  const fired = [];
  for (const item of plan) {
    if (nowTs < item.at) continue;
    const r = await notify(db, userId, item.type, {
      expireAt: user.membership.expireAt,
      graceUntil,
      dedupeKey: `${item.type}:${user.membership.expireAt}`,
    });
    if (r.created) fired.push(item.type);
  }
  return { fired };
}

module.exports = {
  notify,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  checkMembershipReminders,
  buildContent,
  TYPES,
};
