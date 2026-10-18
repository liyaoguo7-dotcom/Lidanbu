/**
 * 礼单簿 · 收礼主页（阶段2 2B）
 * 礼薄列表；空状态；有记录：图案跟随标签（白事灰）、事件名、共计；红色＋底部中间。
 * 金额一律两位小数（formatAmount），图案一律 tagIconPath。
 */
const dataService = require('../../services/data-service.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    events: [],
    hasEvents: false,
    totalCount: 0,
    totalText: '',
  },

  async onShow() {
    await dataService.init();
    await this.reload();
  },

  async reload() {
    const list = await dataService.listEvents();
    const rows = [];
    let totalFen = 0;
    for (const e of list) {
      const st = await dataService.getEventStats(e._id);
      totalFen += st.totalFen;
      const tag = dataService.getTagById(e.tagId) || {};
      rows.push({
        _id: e._id,
        name: e.name,
        sub: `${e.date || ''}｜共${st.count}笔`,
        icon: tagIconPath(tag.id),
        isBaishi: e.tagId === 'baishi',
        amountText: `+${formatAmount(st.totalFen)}`,
      });
    }
    this.setData({
      events: rows,
      hasEvents: rows.length > 0,
      totalCount: rows.length,
      totalText: `￥${formatAmount(totalFen)} 元`,
    });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/receive-add/receive-add' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/receive-detail/receive-detail?id=${id}` });
  },

  goSample() {
    wx.showToast({ title: '示例页占位（2B）', icon: 'none' });
  },
});
