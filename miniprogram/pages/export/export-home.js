/**
 * 礼单簿 · 导出备份（阶段3）
 * 勾选礼薄/送礼 → 当前账本数据情况概览 → 经云函数生成真 xlsx → 发送至微信
 * 成员仅导出授权部分且须"可导出"开关。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    summary: null,
    events: [],
    includeGifts: true,
    exporting: false,
  },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async refresh() {
    wx.showLoading({ title: '' });
    try {
      const summary = await dataService.exportSummary();
      this.setData({
        summary,
        events: (summary.events || []).map((e) => ({ _id: e._id, name: e.name, checked: true })),
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onEventToggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      events: this.data.events.map((ev) => ev._id === id ? { ...ev, checked: !ev.checked } : ev),
    });
  },

  onGiftsToggle() {
    this.setData({ includeGifts: !this.data.includeGifts });
  },

  async onExport() {
    const eventIds = this.data.events.filter((e) => e.checked).map((e) => e._id);
    if (eventIds.length === 0 && !this.data.includeGifts) {
      wx.showToast({ title: '至少勾选一个礼薄或送礼', icon: 'none' });
      return;
    }
    this.setData({ exporting: true });
    wx.showLoading({ title: '生成中' });
    try {
      const result = await dataService.exportXlsx({ eventIds, includeGifts: this.data.includeGifts });
      // result: { fileId }（云函数返回云存储文件ID）
      await dataService.logExportJob(`礼薄${eventIds.length}个${this.data.includeGifts ? '+送礼' : ''}`);
      wx.hideLoading();
      this.setData({ exporting: false });
      const fileId = result && result.fileId;
      if (!fileId) throw new Error('云端未返回文件，请稍后重试');
      const dl = await wx.cloud.downloadFile({ fileID: fileId });
      wx.showModal({
        title: '导出成功',
        content: '账本已生成 Excel，要发送到微信聊天吗？',
        confirmText: '发送至微信',
        success: (res) => {
          if (res.confirm) {
            wx.shareFileMessage({ filePath: dl.tempFilePath, fileName: '礼单簿账本.xlsx' });
          }
        },
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ exporting: false });
      wx.showModal({ title: '导出', content: e.message, showCancel: false });
    }
  },

  onHistory() {
    wx.navigateTo({ url: '/pages/export/export-history' });
  },
});
