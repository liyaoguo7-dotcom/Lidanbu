/**
 * 礼单簿 · 邀请分享（正式版，用户 2026-10-20 决定开启；任务Q2 改名并
 * 合并为全产品唯一的邀请/分享入口——「我的」不再有单独的"分享转发"行）
 *
 * 2026-10-22 任务Z 第 5 项（去码化）：页面不展示邀请码、没有复制、没有填码入口；
 * 邀请只走 open-type="share" 按钮调起微信发送面板，onShareAppMessage 预置
 * 标题与带 inviter 参数的路径（参数对用户不可见、不可编辑），接受侧由
 * app.js 捕获参数后静默绑定（core 邀请奖励的有效判定与防刷规则不变）。
 *
 * 口径（合规）：邀请全凭自愿，文案不出现强制/诱导分享措辞，不要求分享到朋友圈或群聊。
 * 规则与数字全读服务端生效配置（AppConfig + 老板平台覆盖），页面不写死。
 */
const dataService = require('../../services/data-service.js');

function statusText(r) {
  if (r.status === 'granted') return `已发放：收礼名额 +${r.poolGranted} 条、送礼 +${r.giftsGranted} 条`;
  if (r.status === 'bound') return '已绑定，等对方记下第一笔';
  return '未发放';
}

Page({
  data: {
    loading: true,
    enabled: false,
    summary: null,
    progressPct: 0,
  },

  async onShow() {
    await this.refresh();
  },

  async refresh() {
    try {
      await dataService.init();
      const s = await dataService.getInviteSummary();
      const pct = s.maxSuccessfulInvites > 0
        ? Math.min(100, Math.round((s.successfulInvites / s.maxSuccessfulInvites) * 100))
        : 0;
      this.setData({
        loading: false,
        enabled: !!s.enabled,
        summary: {
          ...s,
          records: (s.records || []).map((r) => ({
            ...r,
            statusText: statusText(r),
            dateText: r.at ? new Date(r.at).toLocaleDateString('zh-CN') : '',
          })),
        },
        progressPct: pct,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: dataService.friendly(e), icon: 'none' });
    }
  },

  /** 分享卡片：标题预置（无诱导/强制措辞），路径带 inviter 参数（用户不可见、不可编辑） */
  onShareAppMessage() {
    const inviter = (this.data.summary && this.data.summary.inviteCode) || '';
    return {
      title: '礼单簿：人情往来，一笔笔记清',
      path: `/pages/index/index?inviter=${inviter}`,
    };
  },
});
