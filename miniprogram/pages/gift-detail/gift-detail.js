/**
 * 礼单簿 · 送礼详情（阶段2 2A）
 * 图案跟随标签；表单含日期/姓名/金额/备注（无"类型"）；
 * "查看往来记录＞＞＞"底部居中；底部修改按钮；删除走统一弹窗。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    gift: null,
    tagName: '',
    icon: '',
    contactName: '',
    amountText: '',
    showDelModal: false,
  },

  async onLoad(options) {
    await dataService.init();
    this.giftId = options.id;
    await this.reload();
  },

  async onShow() {
    if (this.giftId) await this.reload();
  },

  async reload() {
    const g = await dataService.getGift(this.giftId);
    if (!g) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const tag = dataService.getTagById(g.tagId) || {};
    const contacts = await dataService.listContacts();
    const c = contacts.find((x) => x._id === g.contactId);
    this.setData({
      gift: g,
      tagName: tag.name || '',
      icon: `/icons/${tag.icon || '10-qita.svg'}`,
      isBaishi: g.tagId === 'baishi',
      contactName: c ? c.name : '—',
      amountText: `￥${(g.amount / 100).toLocaleString()}`,
      date: g.date || '',
      remark: g.remark || '无',
    });
  },

  goWanglai() {
    wx.showToast({ title: '往来竖线树（阶段2B）', icon: 'none' });
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/gift-edit/gift-edit?id=${this.giftId}` });
  },

  onDelete() {
    this.setData({ showDelModal: true });
  },

  onCancelDel() {
    this.setData({ showDelModal: false });
  },

  async onConfirmDel() {
    try {
      await dataService.deleteGift(this.giftId);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this.setData({ showDelModal: false });
    }
  },
});
