/**
 * 礼单簿 · 修改送礼记录（阶段2 2A）
 * 表单预填；保存走 core.updateGift。
 */
const dataService = require('../../services/data-service.js');
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
      amount: String(Math.round(g.amount / 100)),
      remark: g.remark || '',
    });
  },

  onTagChange(e) { this.setData({ tagId: e.detail.id }); },
  onDateChange(e) { this.setData({ date: e.detail.value }); },
  onAmountInput(e) { this.setData({ amount: e.detail.value.replace(/[^\d]/g, '') }); },
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
    const fen = parseInt(this.data.amount, 10);
    if (!fen || fen <= 0) {
      wx.showToast({ title: '请输入正确金额', icon: 'none' });
      return;
    }
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
    }
  },
});
