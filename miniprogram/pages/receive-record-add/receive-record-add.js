/**
 * 礼单簿 · 添加收礼记录（阶段2 2B）
 * 类型 chips（红包/现金/转账/微信/支付宝）+ 日期 + 姓名（跳亲友录选）+ 金额 + 备注。
 * 保存后回礼薄详情并刷新共计；跳亲友录返回保留已填内容（form-state）。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount, parseAmountToFen } = require('../../core/format.js');
const { saveForm, restoreForm, clearForm, wxStorage, RECORD_ADD_KEY, takePick } = require('../../services/form-state.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    types: [],
    type: '微信',
    date: '',
    contactId: '',
    contactName: '',
    amount: '',
    remark: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.eventId = options.eventId || '';
    const types = dataService.getRecordTypes();
    const saved = restoreForm(wxStorage(), RECORD_ADD_KEY);
    if (saved && saved.eventId === this.eventId && saved.type) {
      this.setData({ ...saved, types });
    } else {
      this.setData({ types, type: '微信', date: today() });
    }
  },

  onShow() {
    // 从选择亲友页返回：领取待选项，只补姓名，其余保留
    const st = wxStorage();
    const pick = takePick(st);
    if (pick) {
      const saved = restoreForm(st, RECORD_ADD_KEY) || {};
      const merged = {
        type: saved.type || this.data.type,
        date: saved.date || this.data.date,
        contactId: pick.contactId,
        contactName: pick.contactName,
        amount: saved.amount || this.data.amount,
        remark: saved.remark || this.data.remark,
        eventId: this.eventId,
      };
      this.setData(merged);
      saveForm(st, RECORD_ADD_KEY, merged);
    }
  },

  onTypeTap(e) {
    this.setData({ type: e.currentTarget.dataset.type });
    this.persist();
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
    this.persist();
  },

  onAmountInput(e) {
    let v = (e.detail.value || '').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    this.setData({ amount: v });
    this.persist();
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
    this.persist();
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
    this.persist();
  },

  persist() {
    saveForm(wxStorage(), RECORD_ADD_KEY, {
      eventId: this.eventId,
      type: this.data.type,
      date: this.data.date,
      contactId: this.data.contactId,
      contactName: this.data.contactName,
      amount: this.data.amount,
      remark: this.data.remark,
    });
  },

  goChooseContact() {
    this.persist();
    wx.navigateTo({ url: '/pages/choose-contact/choose-contact?from=receive-record-add' });
  },

  async onSave() {
    if (this._saving) return;
    const { type, date, contactId, amount, remark } = this.data;
    if (!this.eventId) {
      wx.showToast({ title: '请先选择礼薄', icon: 'none' });
      return;
    }
    if (!contactId) {
      wx.showToast({ title: '请选择亲友', icon: 'none' });
      return;
    }
    const fen = parseAmountToFen(amount);
    if (fen === null) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    this._saving = true;
    try {
      await dataService.createRecord(this.eventId, {
        contactId, amountFen: fen, type, remark: (remark || '').trim(), date,
      });
      clearForm(wxStorage(), RECORD_ADD_KEY);
      wx.showToast({ title: '已保存', icon: 'success' });
      wx.navigateBack(); // 成功提示是全局浮层，返回后仍可见：不再固定多等 600ms（2026-10-24 提速，用户反馈新建礼薄等保存后延迟）
    } catch (e) {
      wx.showModal({
        title: '提示',
        content: e.message,
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this._saving = false;
    }
  },
});
