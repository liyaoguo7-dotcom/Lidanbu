/**
 * 礼单簿 · 新增亲友（阶段2 2A）
 * 只有"姓名""备注"两项，都可填可改。from=choose 时保存后直接返回选择页。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: { name: '', remark: '' },

  async onLoad(options) {
    await dataService.init();
    this.from = options.from || '';
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
      const r = await dataService.createContact({ name, remark: (this.data.remark || '').trim() });
      if (r && r.duplicateWarning) {
        // core：重名只提醒不阻止，记录已创建
        wx.showModal({
          title: '已保存',
          content: '重名提醒：亲友录中已有同名联系人（不会合并）。',
          showCancel: false,
          success: () => wx.navigateBack(),
        });
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },
});
