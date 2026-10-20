/**
 * 礼单簿 · 邀请得名额（正式版，用户 2026-10-20 决定开启）
 *
 * 口径（合规）：邀请全凭自愿，文案不出现强制/诱导分享措辞；
 * 绑定有两条等效路径——分享卡片带邀请码自动绑定、手动输入邀请码绑定，
 * 不要求分享到朋友圈或群聊。
 * 规则与数字全读服务端生效配置（AppConfig + 老板平台覆盖），页面不写死。
 */
const dataService = require('../../services/data-service.js');

function statusText(r) {
  if (r.status === 'granted') return `已发放：收礼额度池 +${r.poolGranted} 条、送礼 +${r.giftsGranted} 条`;
  if (r.status === 'bound') return '已绑定，等对方记下第一笔';
  return '未发放';
}

Page({
  data: {
    loading: true,
    enabled: false,
    summary: null,
    progressPct: 0,
    inputCode: '',
    binding: false,
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

  onShareAppMessage() {
    const code = (this.data.summary && this.data.summary.inviteCode) || '';
    return {
      title: '礼单簿——邀请你一起记账，人情往来记得清清楚楚',
      path: `/pages/index/index?inviteCode=${code}`,
    };
  },

  onCopyCode() {
    const code = this.data.summary && this.data.summary.inviteCode;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'none' }),
    });
  },

  onCodeInput(e) {
    this.setData({ inputCode: e.detail.value });
  },

  async onBindSubmit() {
    const code = (this.data.inputCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请先输入邀请码', icon: 'none' });
      return;
    }
    if (this.data.binding) return;
    this.setData({ binding: true });
    try {
      await dataService.bindInviteCode(code);
      wx.showToast({ title: '绑定成功，欢迎加入礼单簿', icon: 'none' });
      this.setData({ inputCode: '' });
      await this.refresh();
    } catch (e) {
      wx.showToast({ title: dataService.friendly(e), icon: 'none' });
    } finally {
      this.setData({ binding: false });
    }
  },
});
