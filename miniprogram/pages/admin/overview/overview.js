/**
 * 老板平台 · 数据概览（阶段5第1项）
 * 只展示条数：用户数、会员数、今日新增、收礼/送礼记录总数。
 * 铁律：无金额、无名单。
 */
const ds = require('../../../services/data-service.js');

Page({
  data: { stats: null, loading: true },
  async onShow() {
    this.setData({ loading: true });
    try {
      const stats = await ds.adminOverview();
      this.setData({ stats, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
