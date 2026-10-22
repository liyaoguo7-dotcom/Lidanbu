/**
 * 礼单簿 · 拍照导入：先选送礼/收礼（阶段4）
 * 会员专属；非会员弹介绍。送礼直接拍照，收礼先去选礼薄。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');
const { saveImport } = require('../../services/import-state.js');

Page({
  data: { hornOff: false, hornRun: false, hornDur: 0, tipText: '先选类型再拍照：收礼要先选好礼薄，送礼直接拍，按拍照顺序导入' },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('import-home'); this.setData({ hornOff: true }); },

  async onLoad() {
    this.setData({ hornOff: hornState.isDismissed('import-home') }); this._syncHorn();
    await dataService.init();
    try {
      const m = await dataService.getMembership();
      if (m.state !== 'member' && m.state !== 'grace') {
        wx.showModal({
          title: '会员专属功能',
          content: '「拍照导入」是会员专属功能，开通会员后即可使用。',
          confirmText: '去看看',
          cancelText: '再想想',
          success: (res) => {
            if (res.confirm) wx.switchTab({ url: '/pages/mine/mine' });
            else wx.navigateBack();
          },
        });
      }
    } catch (e) { /* 演示期忽略 */ }
  },

  /** 送礼：直接拍照，按拍照顺序导入 */
  goGift() {
    this._takePhoto('gift', null);
  },

  /** 收礼：先新建或选择礼薄 */
  goReceive() {
    wx.navigateTo({ url: '/pages/import/import-event' });
  },

  _takePhoto(kind, eventId) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: async (res) => {
        const photoPath = res.tempFilePaths[0];
        wx.showLoading({ title: '识别中...' });
        try {
          const r = await dataService.recognizePhoto(photoPath, kind, { eventId: eventId || '' });
          wx.hideLoading();
          saveImport({ kind, eventId: eventId || '', eventName: '', photoPath, items: r.items, jobId: r.jobId });
          wx.navigateTo({ url: '/pages/import/import-review' });
        } catch (e) {
          wx.hideLoading();
          if (e.code === 'insufficient-points') {
            // 积分不足：识别前就被拦下，没扣积分；引导去购买页补充
            wx.showModal({
              title: '积分不够啦',
              content: e.message || '积分不够啦，先去补充一点积分再来拍照吧。',
              confirmText: '去补充积分',
              cancelText: '算了',
              success: (r) => {
                if (r.confirm) wx.navigateTo({ url: '/pages/member/purchase/purchase' });
              },
            });
            return;
          }
          if (e.code === 'member-required') {
            wx.showModal({
              title: '会员专属功能',
              content: '「拍照导入」是会员专属功能，开通会员后即可使用。',
              confirmText: '去看看',
              cancelText: '再想想',
              success: (r) => {
                if (r.confirm) wx.switchTab({ url: '/pages/mine/mine' });
              },
            });
            return;
          }
          // 识别失败不计费：本次识别不收取任何费用；可直接重新拍照重试
          wx.showModal({
            title: '没认出来',
            content: '这张照片有点糊，没认出来，这次不收任何费用。把礼单放平、光线亮一点，再拍一张试试～',
            confirmText: '重新拍照',
            cancelText: '算了',
            success: (r) => {
              if (r.confirm) this._takePhoto(kind, eventId);
            },
          });
        }
      },
    });
  },
});
