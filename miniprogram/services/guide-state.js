/**
 * 礼单簿 · 首次使用引导状态（任务Q2）
 *
 * 纯逻辑 + storage 读写（可注入假 storage 单测）：
 * - 引导只在首次进入首页前显示一次（storage 标记 guideSeen）；
 * - 从「我的—关于我们」重看时带 from=about：进入重看模式，不看标记、
 *   也不改标记（标记本来就是已看），右上角按钮是「关闭」而非「跳过」。
 */

const GUIDE_KEY = 'guideSeen';

/** 引导共 3 屏 */
const GUIDE_STEPS = 3;

/**
 * 是否进入引导、以及何种模式（纯函数）。
 * @param {{seen:boolean, from?:string}} args
 * @returns {{enter:boolean, review:boolean}} review=true 为重看模式
 */
function resolveGuideEntry({ seen, from }) {
  if (from === 'about') return { enter: true, review: true };
  return { enter: !seen, review: false };
}

function isLastStep(step) {
  return step >= GUIDE_STEPS - 1;
}

/** 下一步序号（纯函数，不越界） */
function nextStep(step) {
  return Math.min(step + 1, GUIDE_STEPS - 1);
}

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

function readSeen(storage) {
  const s = storage || defaultStorage();
  return !!s.get(GUIDE_KEY);
}

function markSeen(storage) {
  const s = storage || defaultStorage();
  s.set(GUIDE_KEY, 1);
}

module.exports = {
  GUIDE_KEY,
  GUIDE_STEPS,
  resolveGuideEntry,
  isLastStep,
  nextStep,
  readSeen,
  markSeen,
};
