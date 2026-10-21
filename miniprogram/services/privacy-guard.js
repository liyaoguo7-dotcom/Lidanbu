/**
 * 礼单簿 · 隐私同意页面层守卫（任务Q2）
 *
 * 分工（与 core 的口径分开，别混）：
 * - core/users 只**记录**同意状态，不拿它当任何功能的门禁（任务Q1 已定版）；
 * - 本模块是**页面层**守卫：只拦"会调用微信隐私接口"的动作——选头像
 *   （chooseAvatar）与拍照导入（要调相机/相册）——未同意时先弹自有隐私弹窗，
 *   同意后继续原动作。记账、浏览等核心功能不拦：不同意也能只读浏览，
 *   首页只显示一条委婉说明。
 *
 * 本文件只放纯逻辑 + 本地标记读写（storage 可注入，方便单测）：
 * 页面拿 evaluate 的结果决定是直接放行还是先弹 privacy-modal。
 */

/** 需要隐私同意的动作（微信隐私接口）：选头像、拍照导入 */
const PRIVACY_ACTIONS = ['chooseAvatar', 'photoImport'];

/** 首页隐私弹窗"已展示过"标记的 storage key（弹过一次就不再每次启动都弹；
 *  真正放行与否看后端同意状态，不看这个标记） */
const POPUP_SHOWN_KEY = 'privacyPopupShown';

function isPrivacyAction(action) {
  return PRIVACY_ACTIONS.includes(action);
}

/**
 * 守卫判定（纯函数）。
 * @param {{agreed:boolean}} state 当前同意状态（后端 privacyConsent.agreed）
 * @param {string} action 动作名
 * @returns {{allowed:boolean, needPopup:boolean}} 非隐私动作恒放行；
 *          隐私动作未同意 → {allowed:false, needPopup:true}（页面先弹弹窗，
 *          同意后重走原动作）；已同意 → 放行。
 */
function evaluate(state, action) {
  if (!isPrivacyAction(action)) return { allowed: true, needPopup: false };
  if (state && state.agreed) return { allowed: true, needPopup: false };
  return { allowed: false, needPopup: true };
}

/**
 * 首次打开是否要弹隐私弹窗（纯函数）：本地没展示过标记、且后端未同意，才弹。
 * 已同意过（换设备也会从后端读到 agreed）或已经弹过一次，都不再弹。
 */
function needsFirstPopup({ localShown, backendAgreed }) {
  return !localShown && !backendAgreed;
}

// —— storage 读写（默认走 wx 本地存储；测试可注入 {get,set} 假实现） ——

function defaultStorage() {
  return {
    get(key) {
      try { return typeof wx !== 'undefined' ? wx.getStorageSync(key) : ''; } catch (e) { return ''; }
    },
    set(key, value) {
      try { if (typeof wx !== 'undefined') wx.setStorageSync(key, value); } catch (e) { /* 忽略 */ }
    },
  };
}

function readPopupShown(storage) {
  const s = storage || defaultStorage();
  return !!s.get(POPUP_SHOWN_KEY);
}

function markPopupShown(storage) {
  const s = storage || defaultStorage();
  s.set(POPUP_SHOWN_KEY, 1);
}

module.exports = {
  PRIVACY_ACTIONS,
  POPUP_SHOWN_KEY,
  isPrivacyAction,
  evaluate,
  needsFirstPopup,
  readPopupShown,
  markPopupShown,
};
