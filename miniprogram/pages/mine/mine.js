/**
 * 礼单簿 · 我的页（任务Q2 重排）
 * 顺序：① 个人资料条（头像+昵称+会员状态，点进个人资料页）
 *      ② 会员与积分卡片（点去购买页；卡内「我的积分」去积分页）
 *      ③ 家庭共享 / 横置礼单本（开关） / 导出备份（行下淡字提示）
 *      ④ 邀请分享（唯一邀请入口，原两个入口已合并为这一个）
 *      ⑤ 通知 / 意见反馈 / 常见问题 / 关于我们 / 联系客服（微信客服按钮）
 *      ⑥ 底部淡字「隐私政策｜注销账号」+ 版本号
 * 昵称默认显示「微信用户」（data-service.displayName 口径），不再写死"我"。
 */
const dataService = require('../../services/data-service.js');
const landscapeRoute = require('../../services/landscape-route.js');
const AppConfig = require('../../config/app-config.js');

/** 会员状态 → 资料条小字 / 演示切换行文字 */
const MEMBER_STATE_LABELS = { free: '免费用户', member: '会员', grace: '会员已到期（缓冲期）', expired: '会员已过期' };
const DEMO_STATE_LABELS = { free: '免费', member: '会员', grace: '会员已到期（缓冲期）', expired: '已过期' };

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

Page({
  data: {
    displayName: '微信用户',
    avatarUrl: '',
    avatarInitial: '微',
    memberStateText: '免费用户',
    isMember: false,
    memberText: '',
    pointsBalance: 0,
    landscapeOn: false,
    demoMode: false,
    demoStateText: '',
    inviteRewardEnabled: false,
    inviteDone: 0,
    inviteMax: 0,
    unreadCount: 0,
    cancelPending: null, // { cancelAtText, remainingDays } 待注销提示（冷静期内）
    version: AppConfig.version || '',
  },

  async onLoad() {
    await dataService.init();
    this.setData({
      inviteRewardEnabled: !!(AppConfig.inviteReward && AppConfig.inviteReward.enabled),
      landscapeOn: landscapeRoute.readLandscapeOn(),
      demoMode: dataService.localMode, // 演示切换行只在本地演示模式出现，正式版没有
    });
    await this.refresh();
  },

  async onShow() {
    // 开关显示与 storage 同步（横置页「切换回竖置样式」会在那边写回 false）
    this.setData({ landscapeOn: landscapeRoute.readLandscapeOn() });
    await this.refresh();
  },

  async refresh() {
    // ① 资料条：头像+昵称+会员状态（昵称改后全局读最新值）
    try {
      const p = await dataService.getProfile();
      this.setData({
        displayName: p.displayName,
        avatarUrl: p.avatarUrl || '',
        avatarInitial: (p.displayName || '微').slice(0, 1),
      });
    } catch (e) { /* 演示期忽略 */ }
    try {
      const m = await dataService.getMembership();
      const isMember = m.state === 'member' || m.state === 'grace';
      let memberText;
      if (m.state === 'member' && m.expireAt) memberText = `会员有效期至 ${fmtDate(m.expireAt)}`;
      else if (m.state === 'grace') memberText = '会员已到期（缓冲期中），续费后立即恢复';
      else if (isMember) memberText = '会员有效期内';
      else memberText = '本子虽小，人情事大～开个会员，让每一笔心意都有处安放';
      this.setData({
        isMember,
        memberText,
        memberStateText: MEMBER_STATE_LABELS[m.state] || m.state,
        demoStateText: DEMO_STATE_LABELS[m.state] || m.state,
      });
    } catch (e) { /* 演示期忽略 */ }
    // ④ 邀请进度：已邀请 x/上限（读真实汇总，页面不写死）
    try {
      const s = await dataService.getInviteSummary();
      this.setData({
        inviteRewardEnabled: !!s.enabled,
        inviteDone: s.successfulInvites || 0,
        inviteMax: s.maxSuccessfulInvites || 0,
      });
    } catch (e) { /* 忽略 */ }
    // 通知未读数（顺带触发会员三提醒判定，见 core/notify）+ 待注销提示
    try {
      const unreadCount = await dataService.getUnreadCount();
      this.setData({ unreadCount });
    } catch (e) { /* 忽略 */ }
    // 积分余额（会员与积分卡展示；积分不过期，与会员状态无关）
    try {
      const pointsBalance = await dataService.getPointsBalance();
      this.setData({ pointsBalance });
    } catch (e) { /* 忽略 */ }
    try {
      const st = await dataService.getCancellationStatus();
      if (st.status === 'pendingCancel') {
        this.setData({
          cancelPending: {
            cancelAtText: fmtDate(st.cancelAt),
            remainingDays: st.remainingDays,
          },
        });
      } else {
        this.setData({ cancelPending: null });
      }
    } catch (e) { /* 忽略 */ }
  },

  /** 演示专用：切换会员状态（免费/会员/会员已到期），切换后全局按新状态走现行规则 */
  onDemoMembership() {
    const modes = ['free', 'member', 'grace'];
    wx.showActionSheet({
      itemList: ['免费', '会员', '会员已到期（缓冲期）'],
      success: async (res) => {
        try {
          const state = await dataService.setDemoMembership(modes[res.tapIndex]);
          wx.showToast({ title: '已切换为：' + (DEMO_STATE_LABELS[state] || state), icon: 'none' });
          await this.refresh();
        } catch (e) {
          wx.showToast({ title: e.message || '切换失败', icon: 'none' });
        }
      },
    });
  },

  onProfile() {
    wx.navigateTo({ url: '/pages/mine/profile' });
  },

  onPurchase() {
    wx.navigateTo({ url: '/pages/member/purchase/purchase' });
  },

  onShareHome() {
    if (!this.data.isMember) {
      wx.showModal({
        title: '会员专属功能',
        content: '「家庭共享邀请」是会员专属功能，开通会员后即可使用。',
        confirmText: '去看看',
        cancelText: '再想想',
        success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/member/member-home' }); },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/share/share-home' });
  },

  onExport() {
    wx.navigateTo({ url: '/pages/export/export-home' });
  },

  onLandscapeToggle() {
    if (!this.data.isMember) {
      wx.showModal({
        title: '会员专属功能',
        content: '「横置礼单本」是会员专属功能，开通会员后即可使用。',
        confirmText: '去看看',
        cancelText: '再想想',
        success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/member/member-home' }); },
      });
      return;
    }
    const next = !this.data.landscapeOn;
    this.setData({ landscapeOn: next });
    landscapeRoute.writeLandscapeOn(next);
    wx.showToast({ title: next ? '横置模式已开启' : '已回到竖置模式', icon: 'none' });
  },

  onInviteReward() {
    wx.navigateTo({ url: '/pages/invite/invite-reward' });
  },

  onNotifications() {
    wx.navigateTo({ url: '/pages/mine/notifications' });
  },

  onPoints() {
    wx.navigateTo({ url: '/pages/mine/points/points' });
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/mine/feedback' });
  },

  onFaq() {
    wx.navigateTo({ url: '/pages/mine/faq' });
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/mine/about' });
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
