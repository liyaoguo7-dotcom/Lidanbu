/**
 * 礼单簿 · 首次使用引导（任务Q2 建，任务R 换真实截图素材）
 * 3 屏：每屏一张真实页面截图（演示数据渲染，素材在主包 images/guide，
 * 由 tools/regen-guide-shots/regen.py 一键重生成）+ 一句配文。
 * 素材原在 packages/guide 分包（2026-10-25 改主包）：引导页是启动首屏，
 * 分包尚未下载时图片永远空白（真机反馈「从来没加载出来过」），主包随包
 * 到达、首屏即可显示；三张共约 223KB，主包体积仍在上限内（自检有断言）。
 * 右上角可跳过，只显示一次（storage 标记，判定在 services/guide-state.js）；
 * 从「我的—关于我们」带 from=about 重看时是重看模式：右上角「关闭」。
 */
const guideState = require('../../services/guide-state.js');

Page({
  data: {
    step: 0,
    review: false,
    total: guideState.GUIDE_STEPS,
    screens: [
      { img: '/images/guide/guide-receive.png', caption: '收到的礼，一笔笔记清楚' },
      { img: '/images/guide/guide-gifts.png', caption: '送出的礼，随时翻看' },
      { img: '/images/guide/guide-timeline.png', caption: '人情往来，一目了然' },
    ],
  },

  onLoad(options) {
    const entry = guideState.resolveGuideEntry({
      seen: guideState.readSeen(),
      from: options && options.from,
    });
    this.setData({ review: entry.review });
  },

  onNext() {
    if (guideState.isLastStep(this.data.step)) {
      this.onFinish();
      return;
    }
    this.setData({ step: guideState.nextStep(this.data.step) });
  },

  /** 跳过（首次）/ 关闭（重看）：首次要落已看标记，重看不动标记 */
  onSkip() {
    this.leave();
  },

  onFinish() {
    this.leave();
  },

  leave() {
    if (!this.data.review) guideState.markSeen();
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' }),
    });
  },
});
