/**
 * 礼单簿 · 注销账号全流程（阶段3 + 任务L）
 *
 * ⚠️ 待用户确认，确认前不上线（AppConfig.accountCancellation.enabled=false，
 * 开关关闭时提交申请会被服务端拒绝，本页只做流程展示）。
 *
 * 流程：第 1 步 说明（删什么/多久删/什么保留）→ 第 2 步 导出提醒
 * （先一键导出再继续；跳过要二次确认）→ 第 3 步 冷静期说明 + 勾选确认
 * → 提交申请进入冷静期（默认 7 天，读配置）→ 冷静期内可撤销，期满自动执行。
 * 已经在冷静期内的，进页直接显示状态与「撤销注销」。
 */
const dataService = require('../../services/data-service.js');
const AppConfig = require('../../config/app-config.js');

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

Page({
  data: {
    step: 1,
    confirmed: false,
    exported: false,
    enabled: !!(AppConfig.accountCancellation && AppConfig.accountCancellation.enabled),
    coolingOffDays: (AppConfig.accountCancellation && AppConfig.accountCancellation.coolingOffDays) || 7,
    pending: null, // { cancelAtText, remainingDays }
    submitting: false,
  },

  async onLoad() {
    await dataService.init();
    await this.refreshStatus();
  },

  async refreshStatus() {
    try {
      const st = await dataService.getCancellationStatus();
      if (st.status === 'pendingCancel') {
        this.setData({
          pending: { cancelAtText: fmtDate(st.cancelAt), remainingDays: st.remainingDays },
        });
      } else {
        this.setData({ pending: null });
      }
    } catch (e) { /* 状态读不到时按未申请展示 */ }
  },

  // —— 第 1 步 → 第 2 步 ——
  onToExport() {
    this.setData({ step: 2 });
  },

  /** 去导出（跳到导出页；导出后回来点继续） */
  onGoExport() {
    this.setData({ exported: true });
    wx.navigateTo({ url: '/pages/export/export-home' });
  },

  /** 跳过导出：二次确认才放行到第 3 步 */
  onSkipExport() {
    wx.showModal({
      title: '还没导出备份',
      content: '注销后数据不能恢复。真的不导出一份留底，直接继续吗？',
      confirmText: '不导出了',
      cancelText: '先去导出',
      success: (res) => {
        if (res.confirm) this.setData({ step: 3 });
      },
    });
  },

  onExportDone() {
    this.setData({ step: 3 });
  },

  // —— 第 3 步：冷静期确认与提交 ——
  onToggleConfirm() {
    this.setData({ confirmed: !this.data.confirmed });
  },

  async onApply() {
    if (!this.data.confirmed) {
      wx.showToast({ title: '请先勾选确认事项', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const r = await dataService.applyCancellation();
      wx.showModal({
        title: '申请已提交',
        content: `你的账号进入 ${r.coolingOffDays} 天冷静期，将在 ${fmtDate(r.cancelAt)} 执行注销。冷静期内正常登录使用，随时可以回来撤销。`,
        showCancel: false,
      });
      await this.refreshStatus();
    } catch (e) {
      wx.showModal({ title: '注销', content: e.message, showCancel: false });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 撤销注销（冷静期内） */
  async onRevoke() {
    try {
      await dataService.revokeCancellation();
      wx.showToast({ title: '已撤销，账号恢复如常', icon: 'success' });
      this.setData({ step: 1, confirmed: false });
      await this.refreshStatus();
    } catch (e) {
      wx.showModal({ title: '撤销失败', content: e.message, showCancel: false });
    }
  },
});
