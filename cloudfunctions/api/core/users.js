/**
 * 礼单簿 · 用户资料与隐私同意（任务Q1）
 *
 * [显示名] 不设单独的"名字"字段。记录里只存记账人的 openid（createdBy），
 * 名字一律在**读取时**用 displayName(作者用户) 现解析——所以用户改了昵称，
 * 历史记录里"这笔是谁记的"会同步显示新昵称，不需要回写任何历史数据。
 * displayName 口径：profile.nickname 非空 → 昵称；否则 → 按账号自动生成的
 * 昵称（BG批用户要求：generatedNickname，「礼友」＋4 位数字，由 openid
 * 派生、同账号恒定；微信号微信不开放给小程序、拿不到，只能生成）。
 * （兼容：旧版本曾在用户顶层写死 nickname='我'，那是程序写的占位、
 * 不是用户自设的昵称，按未设置处理；顶层 nickname 若是其他非空值则沿用。）
 *
 * [昵称修改] updateProfile：trim 清洗、长度上限读配置
 * （AppConfig.profile.nicknameMaxLen，默认 16，按 Unicode 码点计字数）、
 * 空昵称 = 恢复默认（存空串）；非空昵称过内容安全适配层
 * （core/content-safety.js）——不合规拒绝（nickname-rejected）；
 * **适配层抛异常时放行并记审计**：检测服务故障不该堵死改名这件小事，
 * 代价是极少数昵称可能漏检，云端接入 msgSecCheck 后可事后复核，
 * 审计留痕（detail 不含昵称原文，遵守审计脱敏口径）。
 * 头像只存页面层传入的 url 字符串（微信 chooseAvatar 得到的临时/云路径），
 * core 不校验头像内容。
 *
 * [隐私同意] User.privacyConsent = {agreed, agreedAt, version}，
 * version 取配置 AppConfig.legal.privacyVersion。
 * 口径（2026-10-21 用户纠正）：同意状态**只做记录与展示，绝不作任何
 * 功能的门禁**——首次打开由页面层弹窗请用户同意（Q2 页面线），
 * "我的—隐私"入口可查；无论同意与否，拍照导入、记账、浏览等功能
 * 都不因 privacyConsent 被拦截。本模块只提供记录/读取，不提供拦截函数。
 * 纯 JS，无微信依赖。
 */
const { COLLECTIONS, now } = require('./models');
const errors = require('./errors');
const audit = require('./audit');
const contentSafety = require('./content-safety');
const AppConfig = require('../miniprogram/config/app-config');

const DEFAULT_DISPLAY_NAME = '礼友'; // BG批：无昵称时的默认名（有账号编号时后面带 4 位数字）
const LEGACY_PLACEHOLDER_NICKNAME = '我'; // 旧版本写死的自称占位，非用户自设

/**
 * 自动生成昵称（BG批）：由 openid 派生「礼友」＋4 位数字（1000–9999）。
 * 纯函数、同输入同输出——同一账号每次解析都是同一个名字，不落库、不乱变；
 * 不同账号绝大多数不同（四位空间 9000，撞号也只是名字像、不影响数据隔离，
 * 数据一律按 openid 分）。无 openid（用户文档缺失等）时只返回「礼友」。
 */
function generatedNickname(openid) {
  const seed = typeof openid === 'string' ? openid : '';
  if (!seed) return DEFAULT_DISPLAY_NAME;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return DEFAULT_DISPLAY_NAME + (1000 + (h % 9000));
}

/** 显示名解析（读取时调用）：昵称非空用昵称，否则按账号生成昵称 */
function displayName(user) {
  if (user) {
    const nick = user.profile && user.profile.nickname;
    if (typeof nick === 'string' && nick.trim()) return nick.trim();
    const legacy = user.nickname;
    if (typeof legacy === 'string' && legacy.trim() && legacy.trim() !== LEGACY_PLACEHOLDER_NICKNAME) {
      return legacy.trim();
    }
    return generatedNickname(user._id);
  }
  return DEFAULT_DISPLAY_NAME;
}

/* ---------- 隐私同意（只记录/展示，不作门禁） ---------- */

function currentPrivacyVersion(config) {
  return (config && config.legal && config.legal.privacyVersion) || 'v1';
}

/** 归一化某个用户文档的同意状态（纯函数，不查库） */
function consentOf(user, config = AppConfig) {
  const stored = (user && user.privacyConsent) || {};
  return {
    agreed: stored.agreed === true,
    agreedAt: stored.agreedAt || null,
    version: stored.version || '',
    currentVersion: currentPrivacyVersion(config),
  };
}

async function getPrivacyConsent(db, userId, config = AppConfig) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  return consentOf(user, config);
}

/** 记录同意/撤回：同意时记 agreedAt 与当时的政策版本；撤回清 agreedAt。仅记录，不触发任何功能拦截 */
async function setPrivacyConsent(db, userId, agreed, opts = {}) {
  const config = opts.config || AppConfig;
  const consent = {
    agreed: !!agreed,
    agreedAt: agreed ? now() : null,
    version: currentPrivacyVersion(config),
  };
  await db.collection(COLLECTIONS.User).update({ _id: userId }, { privacyConsent: consent });
  return { ...consent, currentVersion: consent.version };
}

/* ---------- 个人资料 ---------- */

/**
 * 修改头像/昵称。patch 只认 nickname / avatarUrl 两个字段。
 * opts: { config?, safety? } safety 为内容安全适配层（测试可注入），
 * 缺省按配置 resolveAdapter。
 * @returns 更新后的用户文档
 */
async function updateProfile(db, userId, patch = {}, opts = {}) {
  const config = opts.config || AppConfig;
  const col = db.collection(COLLECTIONS.User);
  const user = await col.findOne({ _id: userId });
  if (!user) throw new Error('用户不存在，请重新登录');

  const profile = { nickname: '', avatarUrl: '', ...(user.profile || {}) };

  if (patch.nickname !== undefined) {
    const cleaned = String(patch.nickname == null ? '' : patch.nickname).trim();
    const maxLen = (config.profile && config.profile.nicknameMaxLen) || 16;
    // 按 Unicode 码点计字数（一个汉字/一个 emoji 各算 1 个字，与填写体验一致）
    if ([...cleaned].length > maxLen) throw errors.profileDenied('nickname-too-long');
    if (cleaned) {
      const safety = opts.safety || contentSafety.resolveAdapter(config);
      let verdict = null;
      try {
        verdict = await safety.checkText(cleaned);
      } catch (e) {
        // 适配层异常口径：放行 + 审计留痕，不因检测服务故障堵死改名
        await audit.log(db, {
          ownerId: userId, actorId: userId, action: 'profile',
          targetType: 'user', targetId: userId,
          detail: '昵称内容安全检测暂不可用，本次已放行（待云端复核）',
        });
      }
      if (verdict && verdict.pass === false) throw errors.profileDenied('nickname-rejected');
    }
    profile.nickname = cleaned; // 空串 = 恢复默认显示名
  }
  if (patch.avatarUrl !== undefined) {
    profile.avatarUrl = patch.avatarUrl ? String(patch.avatarUrl) : '';
  }

  await col.update({ _id: userId }, { profile });
  return { ...user, profile };
}

/**
 * 取用户原始文档（任务AD 切云新增）：data-service 的会员状态/额度/提醒计算
 * 需要完整文档（membership 等字段），本地与云端共用这一条读取路径；
 * 云端经 api 分发调用时 actorId 即文档主人本人，只返回自己的文档。
 * 不存在返回 null（初始化流程保证先建号，调用方按空文档兜底）。
 */
async function getSelf(db, userId) {
  if (!userId) return null;
  return db.collection(COLLECTIONS.User).findOne({ _id: userId });
}

/**
 * 陪伴天数（2026-10-31 用户定，我的页新方块用）：从注册日（用户文档 createdAt）
 * 起算，注册当天算第 1 天，之后每天加 1；无/非法注册日返回 null，页面不显示
 * 天数、不显示 0 天或乱数。按本地自然日算（两端都先归到当天 0 点再相减）。
 */
function companionDays(createdAt, nowMs) {
  const t = Number(createdAt);
  if (!t || Number.isNaN(t)) return null;
  const now = Number(nowMs) || Date.now();
  const start = new Date(t);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - start) / 86400000);
  return diff >= 0 ? diff + 1 : 1;
}

/** 取用户资料的展示形状：{ displayName, nickname(原始存值), avatarUrl } */
async function getProfile(db, userId) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  const profile = (user && user.profile) || {};
  return {
    displayName: displayName(user),
    nickname: profile.nickname || '',
    avatarUrl: profile.avatarUrl || '',
  };
}

/* ---------- 记录的记账人显示名（读取时解析） ---------- */

/**
 * 给一批记录补 createdByName（按作者**当前**昵称解析，改名即同步）。
 * 返回浅拷贝数组，不改原记录、不把显示名冗余写回存储。
 * 作者用户已不存在（如已注销）时显示默认名 '微信用户'。
 */
async function attachCreatorNames(db, records) {
  const list = records || [];
  const ids = [...new Set(list.map((r) => r && r.createdBy).filter(Boolean))];
  const nameById = {};
  for (const id of ids) {
    const u = await db.collection(COLLECTIONS.User).findOne({ _id: id });
    nameById[id] = displayName(u);
  }
  return list.map((r) => (r ? { ...r, createdByName: nameById[r.createdBy] || DEFAULT_DISPLAY_NAME } : r));
}

module.exports = {
  DEFAULT_DISPLAY_NAME,
  generatedNickname,
  displayName,
  companionDays,
  consentOf,
  getPrivacyConsent,
  setPrivacyConsent,
  updateProfile,
  getProfile,
  getSelf,
  attachCreatorNames,
};
