/**
 * 顶部条形弹窗（AP批形态，AS批按用户真机反馈返工）：
 * 白色紧凑胶囊贴在导航胶囊行：纵向与右上角胶囊按钮中心对齐，右缘
 * 让开胶囊本体（胶囊左缘外 8px），宽度随内容（max-width 78vw）；
 * 左侧红色礼单图标，文字「『人情礼单簿』小程序提供服务」，右侧 ×
 * 可手动关；滑下后停留约 3.5 秒自动滑回收起。
 * 出现规则（AS批定版）：每次打开小程序弹一次——App 每次前台化
 * （冷启动/热启动回前台）globalData.appShowTick +1，本组件经首页
 * onShow 调 tryShow()，与 topBannerShownTick 比对：本周期未弹才弹，
 * 弹过即记 tick，同周期内不重复。全部状态只在内存，关掉小程序
 * 即清零，绝不落 storage（用户点名改掉"删小程序才再出现"）。
 * 位置测不到胶囊时回退：顶部安全区下 8px、右距 96px（真机可调）。
 */
Component({
  data: {
    show: false,   // 节点是否在树上
    animIn: false, // 滑下动画态（true=已落位）
    posStyle: 'top:calc(env(safe-area-inset-top) + 8px);right:96px;',
  },
  lifetimes: {
    attached() {
      this._measureCapsule();
      this.tryShow();
    },
    detached() {
      if (this._slideTimer) clearTimeout(this._slideTimer);
      if (this._timer) clearTimeout(this._timer);
      if (this._hideTimer) clearTimeout(this._hideTimer);
    },
  },
  methods: {
    /** 按胶囊按钮实测位置对齐（不用估值）：纵向中心对齐胶囊、右缘让开胶囊 */
    _measureCapsule() {
      try {
        const rect = typeof wx.getMenuButtonBoundingClientRect === 'function'
          ? wx.getMenuButtonBoundingClientRect() : null;
        const win = typeof wx.getWindowInfo === 'function'
          ? wx.getWindowInfo()
          : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
        if (rect && win && rect.height && rect.width && win.windowWidth) {
          const cy = Math.round(rect.top + rect.height / 2);
          const right = Math.max(8, Math.round(win.windowWidth - rect.left + 8));
          this.setData({ posStyle: `top:${cy}px;right:${right}px;` });
        }
      } catch (e) { /* 测不到用回退定位，不拦显示 */ }
    },

    /** 首页 onShow 调用：本前台化周期未弹过才弹（弹过记 tick） */
    tryShow() {
      let tick = 0;
      let gd = null;
      try {
        const app = typeof getApp === 'function' ? getApp() : null;
        gd = app && app.globalData ? app.globalData : null;
        if (gd && typeof gd.appShowTick === 'number') tick = gd.appShowTick;
      } catch (e) { /* 无 App 上下文时按每次挂载弹（回退） */ }
      const shownTick = gd && typeof gd.topBannerShownTick === 'number'
        ? gd.topBannerShownTick : (this._shownTick || -1);
      if (shownTick === tick || this.data.show) return;
      if (gd) gd.topBannerShownTick = tick; else this._shownTick = tick;
      this.setData({ show: true });
      // 先渲染在上方隐藏位，下一帧加 in 类触发滑下过渡
      this._slideTimer = setTimeout(() => {
        this.setData({ animIn: true });
        this._timer = setTimeout(() => this._dismiss(), 3500);
      }, 30);
    },

    onClose() { this._dismiss(); },
    _dismiss() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (!this.data.show) return;
      this.setData({ animIn: false });
      this._hideTimer = setTimeout(() => this.setData({ show: false }), 320);
    },
  },
});
