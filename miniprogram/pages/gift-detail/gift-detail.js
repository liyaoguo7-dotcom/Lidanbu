/**
 * 礼单簿 · 送礼详情（阶段2 2A）
 * 图案跟随标签；表单含日期/姓名/金额/备注（无"类型"）；
 * "查看往来记录＞＞＞"底部居中；底部修改按钮；删除走统一弹窗。
 */
const dataService = require('../../services/data-service.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount } = require('../../core/format.js');

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
    const contactName = c ? c.name : '—';
    const amountAbs = formatAmount(g.amount || 0); // 金额两位小数，详情按"姓名 · 标签 · 金额"
    this.setData({
      gift: g,
      tagName: tag.name || '',
      icon: tagIconPath(tag && tag.id),
      isBaishi: g.tagId === 'baishi',
      contactName,
      amountText: formatAmount(-(g.amount || 0)), // 送出金额带负号
      delContent: `${contactName} · ${tag.name || ''} · ${amountAbs}`,
      date: g.date || '',
      remark: g.remark || '无',
    });
  },

  goWanglai() {
    const g = this.data.gift;
    if (g && g.contactId) {
      wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${g.contactId}` });
    }
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
