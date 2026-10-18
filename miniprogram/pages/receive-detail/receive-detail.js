/**
 * 礼单簿 · 礼薄详情（阶段2 2B）
 * 图案+标签名+事件名+日期居中；共计；记录行"姓名 / 类型｜日期 +1000.00"；
 * 红色＋底部中间；底部删除/修改（礼薄级）；删除走统一弹窗（含连带条数）。
 */
const dataService = require('../../services/data-service.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    event: null,
    tagName: '',
    icon: '',
    isBaishi: false,
    date: '',
    totalText: '',
    records: [],
    showDelModal: false,
    delContent: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.eventId = options.id;
    await this.reload();
  },

  async onShow() {
    if (this.eventId) await this.reload();
  },

  async reload() {
    const e = await dataService.getEvent(this.eventId);
    if (!e) {
      wx.showToast({ title: '礼薄不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const tag = dataService.getTagById(e.tagId) || {};
    const st = await dataService.getEventStats(this.eventId);
    const contacts = await dataService.listContacts();
    const cmap = {};
    contacts.forEach((c) => { cmap[c._id] = c.name; });
    const recs = await dataService.listRecords(this.eventId);
    const records = recs.map((r) => ({
      _id: r._id,
      name: cmap[r.contactId] || '—',
      subType: r.type || '',
      subDate: r.date || '',
      amountText: `+${formatAmount(r.amount || 0)}`,
    }));
    this.setData({
      event: e,
      tagName: tag.name || '',
      icon: tagIconPath(tag.id),
      isBaishi: e.tagId === 'baishi',
      date: e.date || '',
      totalText: `共计：${st.count} 笔 ￥${formatAmount(st.totalFen)} 元`,
      records,
      delContent: `${e.name}，将同时删除 ${st.count} 条收礼记录`,
    });
  },

  goAddRecord() {
    wx.navigateTo({ url: `/pages/receive-record-add/receive-record-add?eventId=${this.eventId}` });
  },

  goRecordDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/receive-record-detail/receive-record-detail?id=${id}` });
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/receive-add/receive-add?eventId=${this.eventId}` });
  },

  onDelete() {
    this.setData({ showDelModal: true });
  },

  onCancelDel() {
    this.setData({ showDelModal: false });
  },

  async onConfirmDel() {
    try {
      await dataService.deleteEvent(this.eventId);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this.setData({ showDelModal: false });
    }
  },
});
