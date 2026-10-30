/**
 * 礼单簿 · 横置入口路由（纯函数，可单测）
 *
 * 决定点开礼薄/进横置时走横置（landscape）还是竖置（portrait）：
 * - 开关关 → 一律竖置，与接线前行为完全一致；
 * - 开关开 + 会员（member / grace）→ 横置；
 * - 开关开 + 非会员 → 竖置（双保险；横置页内还有一层会员门禁）。
 *
 * 开关状态持久化在 storage key `landscapeModeOn`：
 * - mine 页横置开关写入（会员可开/关，非会员点弹介绍、不写入）；
 * - 横置页「切换回竖置样式」写回 false，避免用户被开关再次自动带回横置；
 * - mine 页 onShow 时读 storage 刷新开关显示。
 *
 * storage 适配器口径与 landscape-core / font-manager 一致：{ get(k), set(k, v) }；
 * 不传时惰性使用 wx 同步存储（Node 测试环境不触碰 wx）。
 */
const STORAGE_KEY = 'landscapeModeOn';

function wxStorage() {
  return {
    get(k) { try { return wx.getStorageSync(k); } catch (e) { return ''; } },
    set(k, v) { try { wx.setStorageSync(k, v); } catch (e) { /* 忽略 */ } },
  };
}

/** 兼容布尔与历史字符串写法（'1' / 'true' / 1 都算开） */
function isOnValue(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function readLandscapeOn(storage) {
  const s = storage || wxStorage();
  try { return isOnValue(s.get(STORAGE_KEY)); } catch (e) { return false; }
}

function writeLandscapeOn(on, storage) {
  const s = storage || wxStorage();
  try { s.set(STORAGE_KEY, !!on); } catch (e) { /* 忽略 */ }
  return !!on;
}

/** membership：data-service.getMembership() 的返回（{state}），或布尔 true 表示会员 */
function isMemberLike(membership) {
  if (membership === true) return true;
  if (!membership || typeof membership !== 'object') return false;
  return membership.state === 'member' || membership.state === 'grace';
}

const MEMBER_ONLY_DEFAULT = ['familyShareInvite', 'photoImport', 'landscapeMode'];

/**
 * 横置两道闸（AM批）：先总开关（features.landscape，关→谁都进不去），
 * 再会员功能名单（含 landscapeMode 且非会员→拦）。flags 取不到时按
 * 总开+算专属处理（与接线前行为一致）。
 * 管理员免会员（2026-10-30）：isAdmin=true 时跳过会员门禁（总开关仍生效）。
 * @returns {'ok'|'master-off'|'member-only'}
 */
function resolveLandscapeGate({ membership, flags, isAdmin } = {}) {
  if (flags && flags.landscape === false) return 'master-off';
  const list = flags && Array.isArray(flags.memberOnly) ? flags.memberOnly : MEMBER_ONLY_DEFAULT;
  if (list.includes('landscapeMode') && !isMemberLike(membership) && !isAdmin) return 'member-only';
  return 'ok';
}

/**
 * @param {{landscapeOn?: boolean, membership?: object|boolean, flags?: object}} input
 * @returns {'landscape'|'portrait'}
 */
function resolveBookRoute({ landscapeOn, membership, flags, isAdmin } = {}) {
  if (!landscapeOn) return 'portrait';
  if (resolveLandscapeGate({ membership, flags, isAdmin }) !== 'ok') return 'portrait';
  return 'landscape';
}

module.exports = { STORAGE_KEY, readLandscapeOn, writeLandscapeOn, isMemberLike, resolveBookRoute, resolveLandscapeGate };
