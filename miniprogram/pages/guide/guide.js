/**
 * 礼单簿 · 首次使用引导（任务Q2）
 * 3 屏：怎么记收礼 / 怎么记送礼 / 往来和亲友录在哪。右上角可跳过，只显示一次
 * （storage 标记，判定在 services/guide-state.js）；从「我的—关于我们」带
 * from=about 重看时是重看模式：右上角「关闭」，看完返回关于页。
 */
const guideState = require('../../services/guide-state.js');

Page({
  data: {
    step: 0,
    review: false,
    total: guideState.GUIDE_STEPS,
    screens: [
      {
        title: '收礼这样记',
        desc: '办酒收到的礼金，先新建一本礼薄，再把亲友送的礼一笔一笔登记上。',
      },
      {
        title: '送礼这样记',
        desc: '去喝喜酒、随份子，在「送礼」里记一笔：送给谁、多少钱、哪一天，清清楚楚。',
      },
      {
        title: '往来和亲友录在下面',
        desc: '屏幕下方的「往来」能看和每位亲友的礼尚往来，「亲友录」管着所有亲友。',
      },
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
