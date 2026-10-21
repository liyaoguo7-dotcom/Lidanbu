/**
 * 礼单簿 · 邀请得名额（正式实现，用户 2026-10-20 决定保留并开启）
 *
 * 玩法：老用户把自己的邀请码给新用户（分享卡片或手动报码都行），
 * 新用户绑定邀请关系后完成"有效动作"，邀请人获得额度奖励：
 * 收礼额度池 +10（用户级、所有礼薄合计）、送礼额度 +5（AppConfig.inviteReward）。
 *
 * 发放条件（全部满足才发）：
 * 1. 被邀请人是新注册用户（绑定时名下还没有礼薄/收礼记录/送礼记录）；
 *    注：绑定判定不看联系人——本地演示种子会给新用户预置联系人，且联系人
 *    本身不构成"已在用账本"的证据；
 * 2. 邀请关系绑定成功（一条 InviteBinding，每位被邀请人最多一条）；
 * 3. 有效动作（二选一，用户 2026-10-20 确认口径）：
 *    A：创建一个礼薄，并添加一位"收礼亲友"；
 *    B：添加一位"送礼亲友"（不要求礼薄）。
 *    「收礼/送礼亲友」= 被邀请人本人新建的联系人（createdBy=本人，
 *    排除演示种子联系人 seed:true；旧数据无 createdBy 不算），
 *    且该联系人被用于 ≥1 条对应记录（收礼记录/送礼记录）。
 *    只记一笔但用的是种子/他人联系人，不算有效动作。
 *
 * 防刷：
 * - 自己邀请自己：拒绝；
 * - 同一被邀请人重复绑定：拒绝；历史上已发放过（含注销后重注册）不再计；
 * - 同一设备指纹重复领取：拒绝（deviceId 为可注入占位，真机采集见联调清单）；
 * - 上限：每个邀请人最多计 maxSuccessfulInvites 次（配置，老板平台可改）；
 * - 每对（邀请人, 被邀请人）只发一次，evaluateInvite 重复调用幂等。
 *
 * 额度接入：发放记录（InviteRewardGrant）是唯一真源，quota.checkAddQuota
 * 每次按记录实数并套生效设置计算，奖励池与会员额度互不影响（会员过期
 * 后奖励池照常可用）。每次发放写一条发放记录 + 一条审计（action:'grant'）。
 *
 * 合规口径：文案与逻辑都不得出现强制/诱导分享措辞；绑定不要求分享到
 * 朋友圈/群聊——分享卡片带码、手动输入邀请码，两条路等效。
 */
const { COLLECTIONS, now } = require('./models');
const AppConfig = require('../miniprogram/config/app-config');
const errors = require('./errors');
const quota = require('./quota');
const audit = require('./audit');
const notify = require('./notify');
const { maskUserId } = require('./admin-mask');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混字符 I/O/0/1

function randomCode() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

/** 我的邀请码：没有就生成并落库（保证全局唯一） */
async function getOrCreateInviteCode(db, userId) {
  const col = db.collection(COLLECTIONS.User);
  const user = await col.findOne({ _id: userId });
  if (!user) throw errors.permDenied('empty-identity');
  if (user.inviteCode) return user.inviteCode;
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    const taken = await col.findOne({ inviteCode: code });
    if (!taken) {
      await col.update({ _id: userId }, { inviteCode: code });
      return code;
    }
  }
  throw new Error('邀请码生成失败，请重试');
}

/** 内部：取生效设置（静态默认 + 老板平台覆盖） */
async function settings(db, config = AppConfig) {
  return quota.resolveInviteSettings(db, config);
}

/**
 * 绑定邀请关系（被邀请人首次打开/手动输入邀请码时调用）
 * @param {string} inviteeId 被邀请人 openid
 * @param {{code:string, deviceId?:string}} opts deviceId 为设备指纹占位（可空）
 * @returns {{inviterId:string(脱敏), status:string}}
 */
async function bindInvite(db, inviteeId, { code, deviceId } = {}, config = AppConfig) {
  const s = await settings(db, config);
  if (!s.enabled) throw errors.inviteDenied('invite-disabled');

  const invitee = await db.collection(COLLECTIONS.User).findOne({ _id: inviteeId });
  if (!invitee) throw errors.permDenied('empty-identity');

  const norm = normalizeCode(code);
  if (!norm) throw errors.inviteDenied('invite-code-invalid');
  const inviter = await db.collection(COLLECTIONS.User).findOne({ inviteCode: norm });
  if (!inviter) throw errors.inviteDenied('invite-code-invalid');
  if (inviter._id === inviteeId) throw errors.inviteDenied('invite-self');

  // 重复绑定拒绝：已有任何绑定记录
  const bindings = db.collection(COLLECTIONS.InviteBinding);
  const existed = await bindings.findOne({ inviteeId });
  if (existed) throw errors.inviteDenied('invite-already-bound');
  // 注销后不重复计：历史发放记录里出现过该被邀请人，一律不再绑定
  const grantedBefore = await db.collection(COLLECTIONS.InviteRewardGrant)
    .findOne({ invitedUserId: inviteeId });
  if (grantedBefore) throw errors.inviteDenied('invite-already-bound');

  // 新用户判定：名下还没有礼薄/收礼记录/送礼记录（联系人不计，见文件头）
  const usedCounts = await Promise.all([
    db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId: inviteeId }),
    db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId: inviteeId }),
    db.collection(COLLECTIONS.GiftRecord).count({ ownerId: inviteeId }),
  ]);
  if (usedCounts.some((n) => n > 0)) throw errors.inviteDenied('invite-not-new-user');

  const { _id } = await bindings.insert({
    inviterId: inviter._id,
    inviteeId,
    code: norm,
    deviceId: deviceId || null,
    status: 'bound',
    boundAt: now(),
    grantedAt: null,
  });
  return { bindingId: _id, inviterId: maskUserId(inviter._id), status: 'bound' };
}

/**
 * 有效动作检查（用户 2026-10-20 确认口径，二选一）：
 * A：≥1 个礼薄 且 有一位"收礼亲友"；B：有一位"送礼亲友"。
 * 「亲友」= 本人新建联系人（ownerId=本人、createdBy=本人、seed!==true，
 * 旧数据缺 createdBy 不算），且被用于 ≥1 条对应记录。
 * 用种子联系人或他人/旧联系人记的记录不算有效动作。
 */
async function checkEligibility(db, inviteeId) {
  const [events, contacts, receiveRecords, giftRecords] = await Promise.all([
    db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId: inviteeId }),
    db.collection(COLLECTIONS.Contact).find({ ownerId: inviteeId }),
    db.collection(COLLECTIONS.ReceiveRecord).find({ ownerId: inviteeId }),
    db.collection(COLLECTIONS.GiftRecord).find({ ownerId: inviteeId }),
  ]);
  const ownNewIds = new Set(
    contacts
      .filter((c) => c.createdBy === inviteeId && c.seed !== true)
      .map((c) => c._id)
  );
  const receiveFriend = receiveRecords.some((r) => ownNewIds.has(r.contactId));
  const giftFriend = giftRecords.some((r) => ownNewIds.has(r.contactId));
  const pathReceive = events >= 1 && receiveFriend;
  const pathGift = giftFriend;
  return {
    eligible: pathReceive || pathGift, pathReceive, pathGift,
    events, receiveRecords: receiveRecords.length, giftRecords: giftRecords.length,
    ownNewContacts: ownNewIds.size, receiveFriend, giftFriend,
  };
}

/**
 * 评估并发放（幂等）：被邀请人每次完成收/送礼记录后、或打开邀请页时调用。
 * 未达条件/已达上限/设备重复时只返回原因，不写发放记录。
 * @returns {{granted:boolean, reason?:string, poolGranted?:number, giftsGranted?:number, alreadyGranted?:boolean}}
 */
async function evaluateInvite(db, inviteeId, { deviceId } = {}, config = AppConfig) {
  const binding = await db.collection(COLLECTIONS.InviteBinding).findOne({ inviteeId });
  if (!binding) return { granted: false, reason: 'no-binding' };
  if (binding.status === 'granted') {
    const g = await db.collection(COLLECTIONS.InviteRewardGrant)
      .findOne({ invitedUserId: inviteeId });
    return {
      granted: true, alreadyGranted: true,
      poolGranted: g ? g.poolGranted : 0, giftsGranted: g ? g.giftsGranted : 0,
    };
  }
  if (binding.status === 'blocked') return { granted: false, reason: 'invite-device-duplicate' };

  const s = await settings(db, config);
  if (!s.enabled) return { granted: false, reason: 'invite-disabled' };

  const elig = await checkEligibility(db, inviteeId);
  if (!elig.eligible) return { granted: false, reason: 'invite-condition-incomplete' };

  // 上限：邀请人已成功次数达到上限，不再发放（绑定保留，之后改上限可再评估）
  const successful = await quota.countSuccessfulInvites(db, binding.inviterId);
  if (successful >= s.maxSuccessfulInvites) return { granted: false, reason: 'invite-cap-reached' };

  // 同设备重复领取拒绝：该设备已为其他被邀请人领取过
  const dev = deviceId || binding.deviceId || null;
  if (dev) {
    const sameDevice = await db.collection(COLLECTIONS.InviteRewardGrant).find({ deviceId: dev });
    if (sameDevice.some((g) => g.invitedUserId !== inviteeId)) {
      await db.collection(COLLECTIONS.InviteBinding)
        .update({ _id: binding._id }, { status: 'blocked' });
      return { granted: false, reason: 'invite-device-duplicate' };
    }
  }

  const poolGranted = s.perInvite.receivePool;
  const giftsGranted = s.perInvite.giftRecords;
  const { _id: grantId } = await db.collection(COLLECTIONS.InviteRewardGrant).insert({
    userId: binding.inviterId,
    invitedUserId: inviteeId,
    poolGranted,
    giftsGranted,
    deviceId: dev,
    grantedAt: now(),
  });
  await db.collection(COLLECTIONS.InviteBinding)
    .update({ _id: binding._id }, { status: 'granted', grantedAt: now() });
  // 审计：只写数量摘要，不含账本内容
  await audit.log(db, {
    ownerId: binding.inviterId,
    actorId: inviteeId,
    action: 'grant',
    targetType: 'inviteReward',
    targetId: grantId,
    detail: `邀请奖励发放：收礼额度池+${poolGranted}、送礼额度+${giftsGranted}`,
  });
  // 通知邀请人奖励到账（任务L）：通知失败绝不影响发放结果；以 grantId 去重防重复发
  try {
    await notify.notify(db, binding.inviterId, 'inviteRewardGranted', {
      poolGranted, giftsGranted, grantId, dedupeKey: `inviteRewardGranted:${grantId}`,
    });
  } catch (e) { /* 忽略 */ }
  return { granted: true, poolGranted, giftsGranted };
}

/** 成功邀请次数（= 发放记录数） */
async function countSuccessfulInvites(db, userId) {
  return quota.countSuccessfulInvites(db, userId);
}

/**
 * 我的邀请奖励汇总（邀请页用，全部只读派生）
 * @returns {{enabled, inviteCode, successfulInvites, maxSuccessfulInvites,
 *   remainingInvites, poolEarned, giftsEarned,
 *   records: [{inviteeId(脱敏), status:'granted'|'bound'|'blocked', poolGranted, giftsGranted, at}],
 *   myBinding: null | {inviterId(脱敏), status}}}
 */
async function getMyInviteSummary(db, userId, config = AppConfig) {
  const s = await settings(db, config);
  const code = await getOrCreateInviteCode(db, userId);
  const grants = await db.collection(COLLECTIONS.InviteRewardGrant)
    .find({ userId }, { sort: { grantedAt: -1 } });
  const myBindings = await db.collection(COLLECTIONS.InviteBinding)
    .find({ inviterId: userId }, { sort: { boundAt: -1 } });
  const grantedIds = new Set(grants.map((g) => g.invitedUserId));
  const records = [];
  for (const g of grants) {
    records.push({
      inviteeId: maskUserId(g.invitedUserId), status: 'granted',
      poolGranted: g.poolGranted || 0, giftsGranted: g.giftsGranted || 0, at: g.grantedAt,
    });
  }
  for (const b of myBindings) {
    if (grantedIds.has(b.inviteeId)) continue;
    records.push({
      inviteeId: maskUserId(b.inviteeId), status: b.status,
      poolGranted: 0, giftsGranted: 0, at: b.boundAt,
    });
  }
  records.sort((a, b2) => (b2.at || 0) - (a.at || 0));
  const mine = await db.collection(COLLECTIONS.InviteBinding).findOne({ inviteeId: userId });
  const successfulInvites = grants.length;
  return {
    enabled: s.enabled,
    inviteCode: code,
    successfulInvites,
    maxSuccessfulInvites: s.maxSuccessfulInvites,
    remainingInvites: Math.max(0, s.maxSuccessfulInvites - successfulInvites),
    poolEarned: grants.reduce((sum, g) => sum + (g.poolGranted || 0), 0),
    giftsEarned: grants.reduce((sum, g) => sum + (g.giftsGranted || 0), 0),
    perInvite: { ...s.perInvite },
    records,
    myBinding: mine ? { inviterId: maskUserId(mine.inviterId), status: mine.status } : null,
  };
}

module.exports = {
  getOrCreateInviteCode,
  bindInvite,
  checkEligibility,
  evaluateInvite,
  countSuccessfulInvites,
  getMyInviteSummary,
};
