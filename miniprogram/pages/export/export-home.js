/**
 * 礼单簿 · 导出备份（阶段3；2026-10-22 任务Z 第 14 项改版）
 * 勾选礼薄/送礼 → 经云函数生成一个 xlsx（送礼一表+每礼薄一表）→
 * 下载到本地后 wx.openDocument 打开预览（showMenu），转发/保存由用户
 * 在文档查看器右上角菜单里操作；页面不再直接发送文件。
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
    if (this.data.exporting) return; // 在途锁（任务AE补修：原只有置位没有入口判断，连点会重复生成）
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
      // 任务Z 第 14 项：只生成文件并打开预览，转发/保存由用户在文档菜单（右上角「···」）里自己操作，
      // 页面不再直接把文件发到聊天。
      wx.openDocument({
        filePath: dl.tempFilePath,
        fileType: 'xlsx',
        showMenu: true,
        fail: () => wx.showModal({
          title: '导出成功',
          content: 'Excel 已生成，但预览打开失败，可以稍后在导出历史里再试。',
          showCancel: false,
        }),
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
