/**
 * 礼单簿 · 修改收礼记录（阶段2 2B，仿 gift-edit）
 * 表单预填（类型/日期/姓名/金额/备注）；保存走 core.updateRecord。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount, parseAmountToFen } = require('../../core/format.js');
const { wxStorage, takePick } = require('../../services/form-state.js');

Page({
  data: {
    types: [],
    type: '',
    date: '',
    contactId: '',
    contactName: '',
    amount: '',
    remark: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.recordId = options.id;
    this.ownerId = options.ownerId || ''; // 成员视角：账本主人 id，缺省=自己
    const d = await dataService.getRecordDetail(this.recordId, this.ownerId || undefined);
    const r = d && d.record;
    if (!r) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const c = d.contact;
    this.setData({
      types: dataService.getRecordTypes(),
      type: r.type || '微信',
      date: r.date || '',
      contactId: r.contactId,
      contactName: c ? c.name : '—',
      amount: formatAmount(r.amount || 0), // 回显两位小数
      remark: r.remark || '',
    });
  },

  async onShow() {
    const pick = takePick(wxStorage());
    if (pick) {
      this.setData({ contactId: pick.contactId, contactName: pick.contactName });
    }
  },

  onTypeTap(e) {
    this.setData({ type: e.currentTarget.dataset.type });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onAmountInput(e) {
    let v = (e.detail.value || '').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    this.setData({ amount: v });
  },

  onAmountBlur() {
    const raw = (this.data.amount || '').trim();
    if (!raw) return;
    const fen = parseAmountToFen(raw);
    if (fen === null) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    this.setData({ amount: formatAmount(fen) });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  goChooseContact() {
    const owner = this.ownerId ? `&ownerId=${this.ownerId}` : '';
    wx.navigateTo({ url: `/pages/choose-contact/choose-contact?from=receive-record-edit${owner}` });
  },

  async onSave() {
    if (this._saving) return;
    const fen = parseAmountToFen(this.data.amount);
    if (fen === null) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    this._saving = true;
    try {
      await dataService.updateRecord(this.recordId, {
        type: this.data.type,
        date: this.data.date,
        contactId: this.data.contactId,
        amount: fen,
        remark: (this.data.remark || '').trim(),
      }, this.ownerId || undefined);
      wx.showToast({ title: '已保存', icon: 'success' });
      wx.navigateBack(); // 成功提示是全局浮层，返回后仍可见：不再固定多等 600ms（2026-10-24 提速，用户反馈新建礼薄等保存后延迟）
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this._saving = false;
    }
  },
});
