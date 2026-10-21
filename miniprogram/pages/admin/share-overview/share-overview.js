/**
 * 老板平台 · 家庭共享概况（阶段5第15项）
 * 只看数量：开共享的账本数、成员总数、每人邀请了几位家人。
 * ownerId 一律脱敏短号。
 */
const ds = require('../../../services/data-service.js');

Page({
  data: { stats: null, loading: true },
  async onShow() {
    this.setData({ loading: true });
    try {
      const stats = await ds.adminShareOverview({ limit: 200 });
      this.setData({ stats, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
