/**
 * 顶部条形弹窗（AP批，参考同类产品形态，用户 2026-10-26 定）：
 * 页面顶部滑下一条白色胶囊，左侧红色礼单图标，文字写死
 * 「『人情礼单簿』小程序提供服务」，右侧 × 可手动关；滑下后停留
 * 约 3.5 秒自动滑回收起。
 * 出现规则：每次冷启动只弹一次——模块级标志 shownThisLaunch 存内存，
 * 冷启动 JS 上下文重建自动清零；页面 onShow 反复触发、组件重复挂载
 * 都不会重弹（与 horn-state 同口径，绝不落 storage）。
 * 暂定值（待用户真机看后可调）：只挂首页、停留 3.5 秒。
 */
let shownThisLaunch = false;

Component({
  data: {
    show: false,   // 节点是否在树上
    animIn: false, // 滑下动画态（true=已落位）
  },
  lifetimes: {
    attached() {
      if (shownThisLaunch) return;
      shownThisLaunch = true;
      this.setData({ show: true });
      // 先渲染在上方隐藏位，下一帧加 in 类触发滑下过渡
      this._slideTimer = setTimeout(() => {
        this.setData({ animIn: true });
        this._timer = setTimeout(() => this._dismiss(), 3500);
      }, 30);
    },
    detached() {
      if (this._slideTimer) clearTimeout(this._slideTimer);
      if (this._timer) clearTimeout(this._timer);
      if (this._hideTimer) clearTimeout(this._hideTimer);
    },
  },
  methods: {
    onClose() { this._dismiss(); },
    _dismiss() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (!this.data.show) return;
      this.setData({ animIn: false });
      this._hideTimer = setTimeout(() => this.setData({ show: false }), 320);
    },
  },
});
