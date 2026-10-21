/**
 * 礼单簿 · 购买会员（任务K）
 * 档位与价格全部从配置读（老板平台配置优先，否则静态占位价），本页不写死价格。
 * 购买走 core/payment 的建单→调起支付→回调发货链路；本地演示为模拟支付，
 * 真实环境换微信虚拟支付适配器，本页不改。
 */
const dataService = require('../../../services/data-service.js');

Page({
  data: {
    plans: [],
    buyingId: '',
    doneText: '',
  },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async refresh() {
    try {
      const plans = await dataService.getPricing();
      this.setData({ plans });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async onBuy(e) {
    const planId = e.currentTarget.dataset.id;
    if (this.data.buyingId) return;
    this.setData({ buyingId: planId, doneText: '' });
    try {
      const r = await dataService.purchaseMembership(planId);
      if (r.delivered) {
        this.setData({ doneText: '开通成功！会员已经生效，新的到期日可以在"我的—会员"里查看。' });
        wx.showToast({ title: '开通成功', icon: 'success' });
      } else {
        wx.showToast({ title: '支付未完成，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
    this.setData({ buyingId: '' });
  },

  onOrders() {
    wx.navigateTo({ url: '/pages/member/orders/orders' });
  },
});
