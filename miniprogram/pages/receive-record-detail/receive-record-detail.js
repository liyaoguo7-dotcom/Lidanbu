/**
 * 礼单簿 · 收礼详情（阶段2 2B，仿 gift-detail）
 * 字段：姓名/类型/日期/金额/备注；底部删除/修改；"查看往来记录＞＞＞"进该亲友竖线树；
 * 删除走统一弹窗。金额两位小数。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    record: null,
    contactName: '',
    type: '',
    date: '',
    amountText: '',
    remark: '',
    showDelModal: false,
    delContent: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.recordId = options.id;
    await this.reload();
  },

  async onShow() {
    if (this.recordId) await this.reload();
  },

  async reload() {
    const r = await dataService.getRecord(this.recordId);
    if (!r) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const c = await dataService.getContact(r.contactId);
    const contactName = c ? c.name : '—';
    const amountAbs = formatAmount(r.amount || 0);
    this.setData({
      record: r,
      contactName,
      contactId: r.contactId,
      type: r.type || '',
      date: r.date || '',
      amountText: amountAbs, // 收礼金额，展示时带正号
      remark: r.remark || '无',
      delContent: `${contactName} · ${r.type || ''} · ${amountAbs}`,
    });
  },

  goWanglai() {
    wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${this.data.contactId}` });
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/receive-record-edit/receive-record-edit?id=${this.recordId}` });
  },

  onDelete() {
    this.setData({ showDelModal: true });
  },

  onCancelDel() {
    this.setData({ showDelModal: false });
  },

  async onConfirmDel() {
    try {
      await dataService.deleteRecord(this.recordId);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this.setData({ showDelModal: false });
    }
  },
});
