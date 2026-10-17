/**
 * 礼单簿 · 修改亲友（阶段2 2A）
 */
const dataService = require('../../services/data-service.js');

Page({
  data: { name: '', remark: '' },

  async onLoad(options) {
    await dataService.init();
    this.contactId = options.id;
    const list = await dataService.listContacts();
    const c = list.find((x) => x._id === this.contactId);
    if (!c) {
      wx.showToast({ title: '联系人不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ name: c.name, remark: c.remark || '' });
  },

  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onRemarkInput(e) { this.setData({ remark: e.detail.value }); },

  async onSave() {
    const name = (this.data.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    try {
      await dataService.updateContact(this.contactId, {
        name, remark: (this.data.remark || '').trim(),
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },
});
