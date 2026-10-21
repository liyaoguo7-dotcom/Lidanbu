/**
 * 礼单簿 · 我的积分（任务P2）
 * 余额 + 规则（数字读配置）+ 流水（来源/消耗/±数/时间/订单号，可对账）。
 * 积分不过期；会员到期后余额保留，续费后继续可用。
 */
const dataService = require('../../../services/data-service.js');

Page({
  data: {
    balance: 0,
    photoImportCost: 0,
    ledger: [],
    loading: true,
  },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async onShow() {
    if (!this.data.loading) await this.refresh();
  },

  async refresh() {
    try {
      const [balance, settings, ledger] = await Promise.all([
        dataService.getPointsBalance(),
        dataService.getPointsSettings(),
        dataService.getPointsLedger(),
      ]);
      this.setData({
        balance,
        photoImportCost: settings.photoImportCost,
        ledger,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onBuy() {
    wx.navigateTo({ url: '/pages/member/purchase/purchase' });
  },
});
