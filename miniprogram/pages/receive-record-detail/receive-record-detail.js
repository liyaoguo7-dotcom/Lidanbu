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
    eventName: '',
    isBaishi: false,
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
    // 顶部徽章右侧显示所属礼薄（事件）名；白事礼薄时徽章转灰（任务Z 第 12 项）
    const ev = r.eventId ? await dataService.getEvent(r.eventId) : null;
    const amountAbs = formatAmount(r.amount || 0);
    this.setData({
      record: r,
      contactName,
      eventName: ev ? (ev.name || '') : '',
      isBaishi: !!(ev && ev.tagId === 'baishi'),
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
    if (this._deleting) return; // 在途锁（任务AE补修：弹窗在 await 期间还开着，连点会重复删）
    this._deleting = true;
    try {
      await dataService.deleteRecord(this.recordId);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this._deleting = false;
      this.setData({ showDelModal: false });
    }
  },
});
