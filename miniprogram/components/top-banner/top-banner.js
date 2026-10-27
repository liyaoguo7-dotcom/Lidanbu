/**
 * 顶部条形弹窗（BA批按用户给的竞品短视频复刻呈现与动画）：
 * 白色胶囊条贴在标题行——左缘距屏幕左 12px，右缘在胶囊左缘外 8px
 * 止步，纵向与胶囊同行居中（胶囊实测定位），高度 32px 约等于胶囊高；
 * 内容为小圆角方形 logo 图＋深色 13px 单行文字「人情礼单簿 小程序
 * 提供服务」。无 × 关闭按钮。动画：从胶囊一侧横向展开（transform-
 * origin 右侧，scaleX 0→1＋淡入约 300ms），停留约 4 秒后同样横向
 * 缩回收起并卸载。
 * 出现规则（AS批定版不变）：每次打开小程序弹一次——App 每次前台化
 * （冷启动/热启动回前台）globalData.appShowTick +1，本组件经首页
 * onShow 调 tryShow()，与 topBannerShownTick 比对：本周期未弹才弹，
 * 弹过即记 tick，同周期内不重复。全部状态只在内存，关掉小程序
 * 即清零，绝不落 storage。
 * 位置测不到胶囊时回退：顶部安全区下 8px、右距 96px（真机可调）。
 */
Component({
  data: {
    show: false,   // 节点是否在树上
    animIn: false, // 横向展开动画态（true=已展开）
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
    /** 按胶囊按钮实测位置对齐（不用估值）：纵向与胶囊居中同行、右缘让开胶囊 */
    _measureCapsule() {
      try {
        const rect = typeof wx.getMenuButtonBoundingClientRect === 'function'
          ? wx.getMenuButtonBoundingClientRect() : null;
        const win = typeof wx.getWindowInfo === 'function'
          ? wx.getWindowInfo()
          : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
        if (rect && win && rect.height && rect.width && win.windowWidth) {
          const BAR_H = 32; // 与 wxss .top-banner height 一致
          const top = Math.round(rect.top + (rect.height - BAR_H) / 2);
          const right = Math.max(8, Math.round(win.windowWidth - rect.left + 8));
          this.setData({ posStyle: `top:${top}px;right:${right}px;` });
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
      // 先渲染在收起态（scaleX 0），下一帧加 in 类触发横向展开过渡
      this._slideTimer = setTimeout(() => {
        this.setData({ animIn: true });
        this._timer = setTimeout(() => this._dismiss(), 4000);
      }, 30);
    },

    _dismiss() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (!this.data.show) return;
      this.setData({ animIn: false });
      this._hideTimer = setTimeout(() => this.setData({ show: false }), 320);
    },
  },
});
