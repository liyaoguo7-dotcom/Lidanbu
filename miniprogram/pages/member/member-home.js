/**
 * 礼单簿 · 会员与额度（阶段3）
 * 会员卡片 / 专属功能 / 额度使用 / 价格占位（不猜价）/ 三次提醒 / 超额只读提示 / 一键导出
 */
const dataService = require('../../services/data-service.js');
const AppConfig = require('../../config/app-config.js');

const STATE_TEXT = {
  free: '普通用户',
  member: '会员有效期内',
  grace: '缓冲期（只读共享）',
  expired: '会员已到期',
};

Page({
  data: {
    state: 'free',
    stateText: '',
    expireText: '',
    quota: null,
    used: null,
    reminders: [],
    plans: [],
    priceNote: '会员价格与档位即将公布，敬请期待。',
    overQuotaNote: '',
  },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async refresh() {
    try {
      const [usage, reminders, plans] = await Promise.all([
        dataService.getQuotaUsage(),
        dataService.getReminderInfo(),
        dataService.getPricing(),
      ]);
      this.setData({ plans });
      const q = usage.quota || {};
      this.setData({
        state: usage.state,
        stateText: STATE_TEXT[usage.state] || usage.state,
        quota: q,
        used: usage.used,
        reminders,
        expireText: reminders.length ? '' : '',
        overQuotaNote: usage.state === 'expired'
          ? '会员已到期，超出免费额度的记录为只读（可查可导出，不能修改和新增），续费后恢复。'
          : '',
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  /** 开通/续费：去购买页（档位与价格都从配置读，本页不写死价格） */
  onBuy() {
    wx.navigateTo({ url: '/pages/member/purchase/purchase' });
  },

  onOrders() {
    wx.navigateTo({ url: '/pages/member/orders/orders' });
  },

  onExport() {
    wx.navigateTo({ url: '/pages/export/export-home' });
  },

  onLandscape() {
    wx.showToast({ title: '横置礼单本效果图待确认', icon: 'none' });
  },
});
