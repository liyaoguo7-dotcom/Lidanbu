/**
 * 礼单簿 · 拍照导入：先选送礼/收礼（阶段4）
 * 会员专属；非会员弹介绍。送礼直接拍照，收礼先去选礼薄。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');

Page({
  data: { hornOff: false, hornRun: false, hornDur: 0, tipText: '先选类型再拍照：收礼要先选好礼薄；选好后可以一次拍多张，攒齐了再开始识别' },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText, { fontPx: 14, avail: 284 }); this.setData({ hornRun: m.run, hornDur: m.dur }); },
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

  /** 送礼：进攒照片页（BJ批：多选/连拍攒齐，点开始识别才识别） */
  goGift() {
    wx.navigateTo({ url: '/pages/import/import-photos?kind=gift' });
  },

  /** 收礼：先新建或选择礼薄 */
  goReceive() {
    wx.navigateTo({ url: '/pages/import/import-event' });
  },

});
