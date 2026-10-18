/**
 * 礼单簿 · 添加送礼记录（阶段2 2A）
 * 10 标签 + 日期 + 姓名 + 金额 + 备注（无"类型"字段）。
 * 跳转选择亲友/新增亲友再返回时，已填内容通过 form-state 保留。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount, parseAmountToFen } = require('../../core/format.js');
const { saveForm, restoreForm, clearForm, wxStorage, GIFT_ADD_KEY, takePick } = require('../../services/form-state.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    tagId: '',
    date: '',
    contactId: '',
    contactName: '',
    amount: '',
    remark: '',
  },

  async onLoad() {
    await dataService.init();
    const st = wxStorage();
    const saved = restoreForm(st, GIFT_ADD_KEY);
    if (saved) {
      this.setData(saved);
    } else {
      this.setData({
        tagId: dataService.getDefaultTagId(),
        date: today(),
      });
    }
  },

  onShow() {
    // 从选择亲友页返回：领取待选项，只补姓名，其余保留
    const st = wxStorage();
    const pick = takePick(st);
    if (pick) {
      const saved = restoreForm(st, GIFT_ADD_KEY) || {};
      const merged = {
        tagId: saved.tagId || this.data.tagId,
        date: saved.date || this.data.date,
        contactId: pick.contactId,
        contactName: pick.contactName,
        amount: saved.amount || this.data.amount,
        remark: saved.remark || this.data.remark,
      };
      this.setData(merged);
      saveForm(st, GIFT_ADD_KEY, merged);
    }
  },

  onTagChange(e) {
    this.setData({ tagId: e.detail.id });
    this.persist();
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
    this.persist();
  },

  onAmountInput(e) {
    // 只保留数字和小数点（至多一个小数点）；校验与两位小数格式化走 blur/保存
    let v = (e.detail.value || '').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    this.setData({ amount: v });
    this.persist();
  },

  onAmountBlur() {
    const raw = (this.data.amount || '').trim();
    if (!raw) return; // 未填不打扰，保存时再拦
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
    saveForm(wxStorage(), GIFT_ADD_KEY, {
      tagId: this.data.tagId,
      date: this.data.date,
      contactId: this.data.contactId,
      contactName: this.data.contactName,
      amount: this.data.amount,
      remark: this.data.remark,
    });
  },

  goChooseContact() {
    this.persist();
    wx.navigateTo({ url: '/pages/choose-contact/choose-contact?from=gift-add' });
  },

  async onSave() {
    const { tagId, date, contactId, contactName, amount, remark } = this.data;
    if (!contactId) {
      wx.showToast({ title: '请选择亲友', icon: 'none' });
      return;
    }
    const fen = parseAmountToFen(amount);
    if (fen === null) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    try {
      await dataService.createGift({
        contactId, tagId, amountFen: fen, remark: (remark || '').trim(), date,
      });
      clearForm(wxStorage(), GIFT_ADD_KEY);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      // 额度用完走委婉文案（core 已是用户可读文案）
      wx.showModal({
        title: '提示',
        content: e.message,
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },
});
