/**
 * 礼单簿 · 注销账号（阶段3）
 * ⚠️ 待用户确认，确认前不上线。
 * 数据策略：删除该用户全部账本数据（亲友/礼薄/收送记录/共享关系/导入导出任务）；
 * 审计日志仅保留不含金额和姓名的流水。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: { confirmed: false },

  onToggleConfirm() {
    this.setData({ confirmed: !this.data.confirmed });
  },

  async onCancel() {
    if (!this.data.confirmed) {
      wx.showToast({ title: '请先勾选确认事项', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '最后确认',
      content: '注销后你的全部账本数据将被永久删除，且无法恢复。确定要继续吗？',
      confirmText: '确认注销',
      confirmColor: '#F0575A',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          await dataService.requestCancel();
          wx.hideLoading();
          wx.showModal({ title: '已注销', content: '你的账本数据已清除。', showCancel: false });
        } catch (e) {
          wx.hideLoading();
          wx.showModal({ title: '注销', content: e.message, showCancel: false });
        }
      },
    });
  },
});
