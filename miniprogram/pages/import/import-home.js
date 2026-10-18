/**
 * 礼单簿 · 拍照导入：先选送礼/收礼（阶段4）
 * 会员专属；非会员弹介绍。送礼直接拍照，收礼先去选礼薄。
 */
const dataService = require('../../services/data-service.js');
const { saveImport } = require('../../services/import-state.js');

Page({
  data: {},

  async onLoad() {
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
          const items = await dataService.recognizePhoto(photoPath, kind);
          wx.hideLoading();
          saveImport({ kind, eventId: eventId || '', eventName: '', photoPath, items });
          wx.navigateTo({ url: '/pages/import/import-review' });
        } catch (e) {
          wx.hideLoading();
          // 失败不计费：本次识别不收取任何费用
          wx.showModal({
            title: '识别失败',
            content: '识别失败了，这次不收任何费用，换张清楚点的照片试试～',
            showCancel: false,
            confirmText: '知道了',
          });
        }
      },
    });
  },
});
