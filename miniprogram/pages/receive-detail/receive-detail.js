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
    totalCount: 0,
    totalAmountText: '0',
    records: [],
    // BV批：搜索栏（照送礼记录页）：本地按姓名筛，不改共计
    all: [],
    shown: [],
    keyword: '',
    searching: false,
    canAdd: true, // 2026-10-31：成员视角按授权 add 开关显隐＋按钮；仅查看时不显示
  },

  async onLoad(options) {
    await dataService.init();
    this.eventId = options.id;
    this.ownerId = options.ownerId || ''; // 成员视角：账本主人 id，缺省=自己
    await this.reload();
  },

  async onShow() {
    if (this.eventId) await this.reload();
  },

  async reload() {
    // 一次取齐（礼薄+明细+联系人名+合计）：原来串行四趟（礼薄→统计→联系人→明细）
    // 成员视角：账本主人参数必须传，否则会读到自己的账；授权 add 开关决定＋按钮显隐
    const owner = this.ownerId || '';
    const d = await dataService.getEventDetail(this.eventId, owner || undefined);
    let canAdd = true;
    if (owner && owner !== dataService.getMyUserId()) {
      const grant = await dataService.getGrantFor(owner).catch(() => null);
      canAdd = !!(grant && grant.switches && grant.switches.add);
    }
    if (!d || !d.event) {
      wx.showToast({ title: '礼薄不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const e = d.event;
    const tag = dataService.getTagById(e.tagId) || {};
    const records = d.records.map((r) => ({
      _id: r._id,
      name: r.contactName || '—',
      subType: r.type || '',
      subDate: r.date || '',
      amountText: formatAmount(r.amount || 0), // 加号在模板里单独加黑
    }));
    this.setData({
      event: e,
      tagName: tag.name || '',
      icon: tagIconPath(tag.id),
      isBaishi: e.tagId === 'baishi',
      date: e.date || '',
      totalText: `${d.count} 笔 ￥${formatAmountInt(d.totalFen)} 元`,
      totalCount: d.count,
      totalAmountText: formatAmountInt(d.totalFen),
      records,
      all: records,
      canAdd,
    });
    this.applyFilter();
  },

  // BV批：与送礼记录页同一筛法（姓名包含关键词；共计仍按全量算，只在非搜索时显示）
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

  goAddRecord() {
    const owner = this.ownerId ? `&ownerId=${this.ownerId}` : '';
    wx.navigateTo({ url: `/pages/receive-record-add/receive-record-add?eventId=${this.eventId}${owner}` });
  },

  goRecordDetail(e) {
    const id = e.currentTarget.dataset.id;
    const owner = this.ownerId ? `&ownerId=${this.ownerId}` : '';
    wx.navigateTo({ url: `/pages/receive-record-detail/receive-record-detail?id=${id}${owner}` });
  },
});
