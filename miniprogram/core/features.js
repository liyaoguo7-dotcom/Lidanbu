/**
 * 礼单簿 · 功能总开关（任务AF 第一版发布口径）
 *
 * 生效值 = appConfig 文档 features 段（老板平台改）优先，否则静态默认。
 * 目前只有 photoImport 一个开关：真实识别未接入前默认关——页面入口
 * 点击提示、服务端接口同步拒绝，两头都关死才算关。
 * 本模块的 getFlags 是公开只读（页面要据此决定入口行为），不含任何
 * 用户数据；写只能走 core/admin 的管理员接口。
 */
const { COLLECTIONS } = require('./models');
const AppConfig = require('../config/app-config');

async function readDoc(db) {
  if (!db) return null;
  try { return await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' }); }
  catch (e) { return null; }
}

/* 生效功能开关 { photoImport, eInvitation, familyShare }（文档段缺字段时逐项回退静态默认） */
async function resolveFlags(db, staticCfg = AppConfig) {
  const doc = await readDoc(db);
  const seg = (doc && doc.features) || {};
  const base = (staticCfg && staticCfg.features) || {};
  return {
    photoImport: typeof seg.photoImport === 'boolean' ? seg.photoImport : !!base.photoImport,
    eInvitation: typeof seg.eInvitation === 'boolean' ? seg.eInvitation : !!base.eInvitation,
    familyShare: typeof seg.familyShare === 'boolean' ? seg.familyShare : !!base.familyShare,
    maintenance: typeof seg.maintenance === 'boolean' ? seg.maintenance : !!base.maintenance,
    registration: typeof seg.registration === 'boolean' ? seg.registration : !!base.registration,
    landscape: typeof seg.landscape === 'boolean' ? seg.landscape : !!base.landscape,
  };
}

async function photoImportEnabled(db) {
  const f = await resolveFlags(db);
  return f.photoImport === true;
}

async function familyShareEnabled(db) {
  const f = await resolveFlags(db);
  return f.familyShare === true;
}

const KNOWN_MEMBER_FEATURES = ['familyShareInvite', 'photoImport', 'landscapeMode'];

/**
 * 生效的「会员功能」名单（AM批真正接上）：appConfig 文档 memberOnlyFeatures
 * 段（老板平台「会员功能」组保存）优先，缺失时回退静态默认（三项全专属）。
 * 名单里的功能只有会员能用；不在名单里则免费用户也能用。读不到文档时
 * 回退静态默认 = 全部算专属（宁可拦住，不漏会员权益）。
 */
async function resolveMemberOnlyFeatures(db, config = AppConfig) {
  if (typeof config === 'string') config = AppConfig;
  const fallback = Array.isArray(config.memberOnlyFeatures) ? [...config.memberOnlyFeatures] : [...KNOWN_MEMBER_FEATURES];
  if (!db) return fallback;
  const doc = await readDoc(db);
  const list = doc && doc.memberOnlyFeatures;
  if (!Array.isArray(list)) return fallback;
  return list.filter((k) => KNOWN_MEMBER_FEATURES.includes(k));
}

async function isMemberOnlyFeature(db, key) {
  const list = await resolveMemberOnlyFeatures(db);
  return list.includes(key);
}

/** 页面用：取生效开关（签名对齐 api 分发 (db, actorId) 口径，actorId 不用） */
async function getFlags(db, actorId) { // eslint-disable-line no-unused-vars
  const flags = await resolveFlags(db);
  const memberOnly = await resolveMemberOnlyFeatures(db);
  return { ...flags, memberOnly };
}

module.exports = { resolveFlags, photoImportEnabled, familyShareEnabled, getFlags, resolveMemberOnlyFeatures, isMemberOnlyFeature, KNOWN_MEMBER_FEATURES };
