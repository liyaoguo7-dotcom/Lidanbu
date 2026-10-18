/**
 * 礼单簿 · XX的账本（家人视角，阶段3）
 * 顶部"正在查看：XX的账本" + 淡字"仅统计已授权给你的记录"
 * 只用已授权数据计算（经 core.stats.memberStats）
 */
const dataService = require('../../services/data-service.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    ownerId: '',
    ownerName: '家人',
    events: [],
    wanglai: [],
    totalIn: '0.00',
    totalOut: '0.00',
  },

  async onLoad(query) {
    await dataService.init();
    this.setData({ ownerId: query.ownerId || '' });
    await this.refresh();
  },

  async refresh() {
    const ownerId = this.data.ownerId;
    if (!ownerId) return;
    wx.showLoading({ title: '' });
    try {
      const [events, list] = await Promise.all([
        dataService.listMemberEvents(ownerId).catch(() => []),
        dataService.getWanglaiList({ ownerId, range: { opt: 'lastYear' } }).catch(() => ({ rows: [], totalReceiveFen: 0, totalGiftFen: 0 })),
      ]);
      this.setData({
        events: events || [],
        wanglai: (list.rows || []).slice(0, 20),
        totalIn: formatAmount(list.totalReceiveFen || 0),
        totalOut: formatAmount(list.totalGiftFen || 0),
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
});
