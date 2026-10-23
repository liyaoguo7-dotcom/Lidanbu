/**
 * 礼单簿 · 修改送礼记录（阶段2 2A）
 * 表单预填；保存走 core.updateGift。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount, parseAmountToFen } = require('../../core/format.js');
const { wxStorage, takePick } = require('../../services/form-state.js');

Page({
  data: {
    tagId: '',
    date: '',
    contactId: '',
    contactName: '',
    amount: '',
    remark: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.giftId = options.id;
    const g = await dataService.getGift(this.giftId);
    if (!g) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const contacts = await dataService.listContacts();
    const c = contacts.find((x) => x._id === g.contactId);
    this.setData({
      tagId: g.tagId,
      date: g.date || '',
      contactId: g.contactId,
      contactName: c ? c.name : '—',
      amount: formatAmount(g.amount || 0), // 回显两位小数（如 1000.00）
      remark: g.remark || '',
    });
  },

  onTagChange(e) { this.setData({ tagId: e.detail.id }); },
  onDateChange(e) { this.setData({ date: e.detail.value }); },
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
  onRemarkInput(e) { this.setData({ remark: e.detail.value }); },

  async onShow() {
    // 从选择亲友页返回：领取待选项
    const pick = takePick(wxStorage());
    if (pick) {
      this.setData({ contactId: pick.contactId, contactName: pick.contactName });
    }
  },

  goChooseContact() {
    wx.navigateTo({ url: '/pages/choose-contact/choose-contact?from=gift-edit' });
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
      await dataService.updateGift(this.giftId, {
        tagId: this.data.tagId,
        date: this.data.date,
        contactId: this.data.contactId,
        amount: fen,
        remark: (this.data.remark || '').trim(),
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this._saving = false;
    }
  },
});
