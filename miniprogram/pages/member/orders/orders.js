/**
 * 礼单簿 · 我的订单（任务K）
 * 只显示本人订单（data-service 按当前用户过滤，他人订单不可见）；
 * 金额为两位小数字符串，由 data-service 用 formatAmount 统一格式化。
 */
const dataService = require('../../../services/data-service.js');

Page({
  data: { orders: [] },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async onShow() {
    if (this._loaded) await this.refresh();
  },

  async refresh() {
    try {
      const orders = await dataService.listMyOrders();
      this.setData({ orders });
      this._loaded = true;
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onBuy() {
    wx.navigateTo({ url: '/pages/member/purchase/purchase' });
  },
});
