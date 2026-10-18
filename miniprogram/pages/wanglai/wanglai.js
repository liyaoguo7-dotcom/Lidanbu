/**
 * 礼单簿 · 往来页（阶段2 2B，替换 2A 占位）
 * 时间筛选（今日/本月/今年/近一年/自定义起止）+ 收到总额/送出总额/差额
 * （淡黄底红字，差额=收到-送出）+ 搜索框（输入姓名出联系人，点进竖线树）。
 * 调 data-service.getWanglaiList（经 core.stats.contactStats/memberStats）。
 * ?ownerId=xxx 时为成员视角：顶部淡字"仅统计已授权给你的记录"。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount } = require('../../core/format.js');

const RANGES = [
  { id: 'today', name: '今日' },
  { id: 'month', name: '本月' },
  { id: 'year', name: '今年' },
  { id: 'lastYear', name: '近一年' },
  { id: 'custom', name: '自定义' },
];

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    ranges: RANGES,
    rangeId: 'lastYear',
    customFrom: '',
    customTo: '',
    keyword: '',
    searching: false,
    searchResults: [],
    rows: [],
    isMember: false,
    summaryText: '',
    diffText: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.ownerId = options.ownerId || '';
    const t = today();
    this.setData({ customFrom: t, customTo: t });
    await this.reload();
  },

  async onShow() {
    await this.reload();
  },

  rangeParam() {
    if (this.data.rangeId === 'custom') {
      return { start: this.data.customFrom, end: this.data.customTo };
    }
    return this.data.rangeId;
  },

  async reload() {
    const kw = (this.data.keyword || '').trim();
    try {
      if (kw) {
        // 搜索模式：输入姓名出联系人
        const list = await dataService.searchWanglaiContacts({ ownerId: this.ownerId || undefined, keyword: kw });
        this.setData({
          searching: true,
          searchResults: list.map((c) => ({ contactId: c._id, name: c.name, remark: c.remark || '' })),
        });
        return;
      }
      const r = await dataService.getWanglaiList({
        ownerId: this.ownerId || undefined,
        range: this.rangeParam(),
      });
      const rows = r.rows.map((x) => ({
        ...x,
        countText: `${x.count}笔`,
        diffText: `${x.diffFen < 0 ? '-' : '+'}${formatAmount(Math.abs(x.diffFen))}`,
      }));
      const recv = formatAmount(r.totalReceiveFen);
      const gift = formatAmount(r.totalGiftFen);
      const diff = r.diffFen;
      this.setData({
        searching: false,
        rows,
        isMember: r.isMember,
        summaryText: `共计：${rows.length} 位亲友`,
        diffText: `人情差额：收到 ${recv} − 送出 ${gift} = ${diff < 0 ? '-' : '+'}${formatAmount(Math.abs(diff))}`,
      });
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },

  onRangeTap(e) {
    this.setData({ rangeId: e.currentTarget.dataset.id });
    this.reload();
  },

  onCustomFromChange(e) {
    this.setData({ customFrom: e.detail.value, rangeId: 'custom' });
    this.reload();
  },

  onCustomToChange(e) {
    this.setData({ customTo: e.detail.value, rangeId: 'custom' });
    this.reload();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.reload();
  },

  onCancelSearch() {
    this.setData({ keyword: '' });
    this.reload();
  },

  goTimeline(e) {
    const id = e.currentTarget.dataset.id;
    const ownerQ = this.ownerId ? `&ownerId=${this.ownerId}` : '';
    wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${id}${ownerQ}` });
  },
});
