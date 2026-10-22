/**
 * 礼单簿 · 小喇叭关闭状态（全 App 统一口径，2026-10-22 用户定版）
 *
 * 规则：用户点小喇叭右侧「×」后，**本次打开期间不再显示**；下次冷启动重新显示
 * （若那时还有要提示的内容）。
 * 实现：状态只存本模块的内存变量，**绝不落 wx storage**——小程序冷启动时 JS
 * 上下文重建、模块变量自动清零，天然满足"下次打开再显示"，无需任何持久化清理。
 * 每个小喇叭实例一个 key（页面级），互不影响。
 */
const dismissed = new Set();

function isDismissed(key) {
  return dismissed.has(key);
}

function dismiss(key) {
  dismissed.add(key);
  return true;
}

/** 仅供测试：复位全部关闭状态（模拟冷启动） */
function _resetForTest() {
  dismissed.clear();
}

module.exports = { isDismissed, dismiss, _resetForTest };
