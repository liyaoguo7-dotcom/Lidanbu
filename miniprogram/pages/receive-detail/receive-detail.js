/**
 * 礼单簿 · 礼薄详情（阶段2 2B）
 * 图案+标签名+事件名+日期居中；共计；记录行"姓名 / 类型｜日期 +1000.00"；
 * 红色＋底部中间；礼薄级修改/删除不在本页（2026-10-22 用户定：收礼列表左滑已有修改/删除入口）。
 */
const dataService = require('../../services/data-service.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount, formatAmountInt } = require('../../core/format.js');

Page({
  data: {
    event: null,
    tagName: '',
    icon: '',
    isBaishi: false,
    date: '',
    totalText: '',
    records: [],
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
      totalText: `${st.count} 笔 ￥${formatAmountInt(st.totalFen)} 元`,
      records,
    });
  },

  goAddRecord() {
    wx.navigateTo({ url: `/pages/receive-record-add/receive-record-add?eventId=${this.eventId}` });
  },

  goRecordDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/receive-record-detail/receive-record-detail?id=${id}` });
  },
});
