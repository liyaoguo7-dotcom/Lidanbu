/**
 * 礼单簿 · 我的页（阶段2 2A）
 * 会员卡片 + 会员专属功能区 + 横置模式开关（会员专属，普通用户点弹介绍）
 * + 联系客服/分享转发 + 隐私政策｜注销账号 + 邀请得名额（已开启，读配置开关）
 */
const dataService = require('../../services/data-service.js');
const landscapeRoute = require('../../services/landscape-route.js');
const AppConfig = require('../../config/app-config.js');

Page({
  data: {
    isMember: false,
    memberText: '',
    landscapeOn: false,
    feats: [
      { icon: '/images/icons/family.svg', title: '家庭共享邀请', desc: '邀请家人共记一本账，查看/新增/修改/删除/导出权限由你定' },
      { icon: '/images/icons/book.svg', title: '横置红字礼单本', desc: '经典红字大写，横置翻阅，仪式感拉满' },
    ],
    inviteRewardEnabled: false,
  },

  async onLoad() {
    await dataService.init();
    this.setData({
      inviteRewardEnabled: !!(AppConfig.inviteReward && AppConfig.inviteReward.enabled),
      landscapeOn: landscapeRoute.readLandscapeOn(),
    });
    await this.refresh();
  },

  async onShow() {
    // 开关显示与 storage 同步（横置页「切换回竖置样式」会在那边写回 false）
    this.setData({ landscapeOn: landscapeRoute.readLandscapeOn() });
    await this.refresh();
  },

  async refresh() {
    try {
      const m = await dataService.getMembership();
      const isMember = m.state === 'member' || m.state === 'grace';
      const q = m.quota || {};
      this.setData({
        isMember,
        memberText: isMember ? '会员有效期内' : '本子虽小，人情事大～开个会员，让每一笔心意都有处安放',
      });
    } catch (e) { /* 演示期忽略 */ }
  },

  onMemberCard() {
    wx.navigateTo({ url: '/pages/member/member-home' });
  },

  onLandscapeToggle() {
    if (!this.data.isMember) {
      wx.showModal({
        title: '会员专属功能',
        content: '「经典红字大写横置礼单本」是会员专属功能，开通会员后即可使用。',
        confirmText: '去看看',
        cancelText: '再想想',
        success: (res) => { if (res.confirm) this.onMemberCard(); },
      });
      return;
    }
    const next = !this.data.landscapeOn;
    this.setData({ landscapeOn: next });
    landscapeRoute.writeLandscapeOn(next);
    wx.showToast({ title: next ? '横置模式已开启' : '已回到竖置模式', icon: 'none' });
  },

  onService() {
    wx.showToast({ title: '联系客服（待接入）', icon: 'none' });
  },

  onShare() {
    wx.showToast({ title: '分享转发（待接入）', icon: 'none' });
  },

  onInviteReward() {
    wx.navigateTo({ url: '/pages/invite/invite-reward' });
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onLogout() {
    wx.navigateTo({ url: '/pages/mine-cancel/mine-cancel' });
  },

  // 老板平台开发期隐藏入口：连点版本号 5 次进入。生产部署方式待定。
  _versionTaps: 0,
  _versionTimer: null,
  onVersionTap() {
    this._versionTaps += 1;
    clearTimeout(this._versionTimer);
    this._versionTimer = setTimeout(() => { this._versionTaps = 0; }, 2000);
    if (this._versionTaps >= 5) {
      this._versionTaps = 0;
      wx.navigateTo({ url: '/pages/admin/admin-home/admin-home' });
    }
  },
});
