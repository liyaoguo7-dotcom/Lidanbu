/**
 * 礼单簿 · 送礼记录列表（阶段2 2A）
 * 最新在上；金额送出带负号；行内"场合｜日期"；＋底部中间；
 * 搜索框右侧"取消"，无结果显示空结果态。
 */
const dataService = require('../../services/data-service.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount } = require('../../core/format.js');

function fmtDate(d) {
  return d || '';
}

Page({
  data: {
    all: [],
    shown: [],
    keyword: '',
    searching: false,
    totalCount: 0,
    totalFen: 0,
  },

  async onShow() {
    await dataService.init();
    await this.reload();
  },

  async reload() {
    const list = await dataService.listGifts();
    // 补联系人姓名与标签名（演示期直接读库）
    const contacts = await dataService.listContacts();
    const cmap = {};
    contacts.forEach((c) => { cmap[c._id] = c.name; });
    const tags = {};
    dataService.getTags().forEach((t) => { tags[t.id] = t; });
    const all = list.map((g) => {
      const tag = tags[g.tagId] || {};
      return {
        _id: g._id,
        name: cmap[g.contactId] || '—',
        tagName: tag.name || '',
        icon: tagIconPath(tag && tag.id),
        date: fmtDate(g.date),
        amountText: formatAmount(-(g.amount || 0)),
      };
    });
    const totalFen = list.reduce((s, g) => s + (g.amount || 0), 0);
    this.setData({
      all,
      totalCount: list.length,
      totalFen,
      totalText: `￥${formatAmount(totalFen)} 元`,
    });
    this.applyFilter();
  },

  applyFilter() {
    const kw = (this.data.keyword || '').trim();
    const shown = kw
      ? this.data.all.filter((r) => r.name.includes(kw))
      : this.data.all;
    this.setData({ shown, searching: !!kw });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  onCancelSearch() {
    this.setData({ keyword: '', searching: false });
    this.applyFilter();
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/gift-add/gift-add' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/gift-detail/gift-detail?id=${id}` });
  },
});
