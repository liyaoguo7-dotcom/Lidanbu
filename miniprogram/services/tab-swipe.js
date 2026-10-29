/** CO批（用户 2026-10-29 定）：四个 tab 页左右滑动切换 tab（共用逻辑）。
 * 左滑 → 下一个 tab（向右），右滑 → 上一个 tab；到头不循环。
 * 只认横向主导的滑动（横向 ≥60px 且横向 ≥ 纵向×1.5），竖向滚动、
 * 点按、亲友录字母索引竖拖都不触发。
 * DA批（用户同日选方案 1）：滑动过程加推出动画——手指横向拖动时整页
 * 内容跟手平移，松手够远即 switchTab（新页直接出现、无滑入），不够远
 * 则弹回原位。平移用 left 不用 transform，避免 fixed 子元素定位错乱；
 * 各页 onShow 清掉上次滑动的位移。 */
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
    this._tabSwipeApplied = 0;
    this.setData({ swipeX: 0, swipeAnim: false });
  },
  onTabSwipeMove(e) {
    if (this._tabSwipeX === undefined) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tabSwipeX;
    const dy = t.clientY - this._tabSwipeY;
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1].route;
    const norm = '/' + String(cur).replace(/^\//, '');
    const i = TAB_SWIPE_TABS.indexOf(norm);
    let x = 0;
    if (i >= 0 && Math.abs(dx) >= 10 && Math.abs(dx) >= Math.abs(dy) * 1.5) {
      const next = dx < 0 ? i + 1 : i - 1;
      if (next >= 0 && next < TAB_SWIPE_TABS.length) {
        let w = 375;
        try { w = wx.getWindowInfo().windowWidth; } catch (err) { /* 用默认值 */ }
        x = Math.max(-w, Math.min(w, dx));
      }
    }
    if (x !== this._tabSwipeApplied) {
      this._tabSwipeApplied = x;
      this.setData({ swipeX: x, swipeAnim: false });
    }
  },
  onTabSwipeEnd(e) {
    if (this._tabSwipeX === undefined) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tabSwipeX;
    const dy = t.clientY - this._tabSwipeY;
    this._tabSwipeX = undefined;
    this._tabSwipeY = undefined;
    this._tabSwipeApplied = 0;
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1].route;
    const next = tabSwipeNext(cur, dx, dy);
    if (next) wx.switchTab({ url: next });
    else this.setData({ swipeX: 0, swipeAnim: true }); // 不够远：弹回原位
  },
};

module.exports = { TAB_SWIPE_TABS, TAB_SWIPE_MIN_DX, tabSwipeNext, tabSwipeHandlers };
