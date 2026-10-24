/**
 * 礼单簿 · 个人资料（任务Q2）
 * 头像用微信现行 chooseAvatar 按钮（open-type="chooseAvatar"）、昵称用
 * type="nickname" 输入框；保存走 data-service.updateProfile（长度与敏感词
 * 校验在 core，错误是委婉文案直接 toast）。默认显示名「微信用户」。
 * 选头像属于隐私接口：进入选择前先过页面层隐私守卫（privacy-guard），
 * 未同意先弹 privacy-modal，同意后才露出真正的选头像按钮。
 */
const dataService = require('../../services/data-service.js');
const privacyGuard = require('../../services/privacy-guard.js');
const AppConfig = require('../../config/app-config.js');

const MEMBER_LABELS = { free: '免费用户', member: '会员', grace: '会员已到期（缓冲期）', expired: '会员已过期' };

Page({
  data: {
    nickname: '',
    avatarUrl: '',       // 已保存的头像
    tempAvatar: '',      // 本次新选、还没保存的头像
    avatarChanged: false,
    maxLen: (AppConfig.profile && AppConfig.profile.nicknameMaxLen) || 16,
    memberText: '',
    privacyAgreed: false,
    privacyShow: false,
    saving: false,
  },

  async onLoad() {
    await dataService.init();
    await this.refresh();
  },

  async refresh() {
    // 三个读取互相独立，并发取（原串行三趟）
    await Promise.all([
      (async () => { try {
        const p = await dataService.getProfile();
        this.setData({ nickname: p.nickname || '', avatarUrl: p.avatarUrl || '' });
      } catch (e) { /* 忽略 */ } })(),
      (async () => { try {
        const m = await dataService.getMembership();
        this.setData({ memberText: MEMBER_LABELS[m.state] || m.state });
      } catch (e) { /* 忽略 */ } })(),
      (async () => { try {
        const c = await dataService.getPrivacyConsent();
        const verdict = privacyGuard.evaluate({ agreed: !!(c && c.agreed) }, 'chooseAvatar');
        this.setData({ privacyAgreed: verdict.allowed });
      } catch (e) { /* 忽略 */ } })(),
    ]);
  },

  /** chooseAvatar 按钮回调：先临时显示，点保存才落库 */
  onChooseAvatar(e) {
    const url = e && e.detail && e.detail.avatarUrl;
    if (!url) return;
    this.setData({ tempAvatar: url, avatarChanged: true });
  },

  /** 未同意隐私时头像行是个普通入口：点它先弹隐私窗 */
  onAvatarGate() {
    this.setData({ privacyShow: true });
  },

  async onPrivacyAgree() {
    try { await dataService.setPrivacyConsent(true); } catch (e) { /* 忽略 */ }
    privacyGuard.markPopupShown();
    this.setData({ privacyShow: false, privacyAgreed: true });
    wx.showToast({ title: '好啦，现在可以选头像了', icon: 'none' });
  },

  onPrivacyDisagree() {
    this.setData({ privacyShow: false });
    wx.showToast({ title: '没关系，同意后随时能换头像', icon: 'none' });
  },

  onPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onPrivacyAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  async onSave() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const patch = { nickname: this.data.nickname };
      if (this.data.avatarChanged && this.data.tempAvatar) patch.avatarUrl = this.data.tempAvatar;
      const r = await dataService.updateProfile(patch);
      this.setData({
        avatarUrl: r.avatarUrl || this.data.avatarUrl,
        tempAvatar: '',
        avatarChanged: false,
        nickname: r.nickname || '',
      });
      wx.showToast({ title: '保存好了', icon: 'none' });
    } catch (e) {
      // updateProfile 抛出的已是委婉文案（超长/敏感词），直接提示
      wx.showToast({ title: e.message || '保存失败，请再试一次', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
