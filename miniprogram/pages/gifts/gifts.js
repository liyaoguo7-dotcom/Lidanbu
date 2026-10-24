/**
 * 礼单簿 · 送礼记录列表（阶段2 2A）
 * 最新在上；金额送出带负号；行内"场合｜日期"；＋底部中间；
 * 搜索框右侧"取消"，无结果显示空结果态。
 */
const dataService = require('../../services/data-service.js');
const landscapeRoute = require('../../services/landscape-route.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount, formatAmountInt } = require('../../core/format.js');

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
    totalAmountText: '0',
    showLandscapeEntry: false,
  },

  async onShow() {
    await dataService.init();
    // 横置入口仅在 mine 页横置开关开启时显示（开关状态存 storage）
    this.setData({ showLandscapeEntry: landscapeRoute.readLandscapeOn() });
    await this.reload();
  },

  goSample() {
    wx.navigateTo({ url: '/pages/example/gift-example' });
  },

  goLandscape() {
    wx.navigateTo({ url: '/pages/landscape/gift/gift' });
  },

  async reload() {
    // 记录与联系人并发取（原来串行两趟，2026-10-24 提速）
    const [list, contacts] = await Promise.all([
      dataService.listGifts(),
      dataService.listContacts(),
    ]);
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
        amountText: formatAmount(g.amount || 0), // 符号在模板里单独加黑（用户 2026-10-24：减号也要黑）
      };
    });
    const totalFen = list.reduce((s, g) => s + (g.amount || 0), 0);
    this.setData({
      all,
      totalCount: list.length,
      totalFen,
      totalText: `￥${formatAmountInt(totalFen)} 元`,
      totalAmountText: formatAmountInt(totalFen),
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
