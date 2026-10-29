/** CO批（用户 2026-10-29 定）：四个 tab 页左右滑动切换 tab（共用逻辑）。
 * 左滑 → 下一个 tab（向右），右滑 → 上一个 tab；到头不循环。
 * 只认横向主导的滑动（横向 ≥60px 且横向 ≥ 纵向×1.5），竖向滚动、
 * 点按、亲友录字母索引竖拖都不触发。 */
const TAB_SWIPE_TABS = ['/pages/index/index', '/pages/wanglai/wanglai', '/pages/contacts/contacts', '/pages/mine/mine'];
const TAB_SWIPE_MIN_DX = 60;

function tabSwipeNext(curRoute, dx, dy) {
  if (Math.abs(dx) < TAB_SWIPE_MIN_DX) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  const norm = '/' + String(curRoute).replace(/^\//, '');
  const i = TAB_SWIPE_TABS.indexOf(norm);
  if (i < 0) return null;
  const next = dx < 0 ? i + 1 : i - 1;
  if (next < 0 || next >= TAB_SWIPE_TABS.length) return null;
  return TAB_SWIPE_TABS[next];
}

const tabSwipeHandlers = {
  onTabSwipeStart(e) {
    const t = e.changedTouches[0];
    this._tabSwipeX = t.clientX;
    this._tabSwipeY = t.clientY;
  },
  onTabSwipeEnd(e) {
    if (this._tabSwipeX === undefined) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tabSwipeX;
    const dy = t.clientY - this._tabSwipeY;
    this._tabSwipeX = undefined;
    this._tabSwipeY = undefined;
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1].route;
    const next = tabSwipeNext(cur, dx, dy);
    if (next) wx.switchTab({ url: next });
  },
};

module.exports = { TAB_SWIPE_TABS, TAB_SWIPE_MIN_DX, tabSwipeNext, tabSwipeHandlers };
