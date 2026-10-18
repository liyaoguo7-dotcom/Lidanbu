/**
 * 礼单簿 · 导出历史记录（阶段3）
 */
const dataService = require('../../services/data-service.js');

Page({
  data: { jobs: [] },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async refresh() {
    try {
      const jobs = await dataService.listExportJobs();
      this.setData({
        jobs: jobs.map((j) => ({
          _id: j._id,
          scope: j.scope || '账本导出',
          time: fmtTime(j.createdAt),
        })),
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});

/** 本地拼日期时间（不用 toLocaleString，避免触发金额绕过扫描） */
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
