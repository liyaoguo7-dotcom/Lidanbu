/**
 * 礼单簿 · 家庭共享入口（阶段3）
 * 邀请家人（会员专属）/ 成员管理 / 我收到的共享
 */
const dataService = require('../../services/data-service.js');
const AppConfig = require('../../config/app-config.js');
const SLOGANS_CLOSED_KEY = 'shareHomeSlogansClosed'; // AZ批：标语块关闭标记（本机）

Page({
  data: {
    isMember: false,
    received: [],
    showSlogans: true, // AZ批：标语块是否显示（关掉后本机不再显示）
  },

  async onLoad() {
    let closed = false;
    try { closed = !!wx.getStorageSync(SLOGANS_CLOSED_KEY); } catch (e) { /* 读不到按显示 */ }
    this.setData({ showSlogans: !closed });
    await dataService.init();
  },

  /** AZ批：关掉标语块（本机持久，不再显示；页面恢复无标语样子） */
  onCloseSlogans() {
    try { wx.setStorageSync(SLOGANS_CLOSED_KEY, 1); } catch (e) { /* 存不下也先关本次 */ }
    this.setData({ showSlogans: false });
  },

  async onShow() {
    const [m, received] = await Promise.all([
      dataService.getMembership().catch(() => null),
      dataService.myReceivedShares().catch(() => []),
    ]);
    this.setData({
      isMember: !!(m && (m.state === 'member' || m.state === 'grace')),
      received,
    });
  },

  /** 邀请家人：会员专属，普通用户弹会员介绍 */
  onInvite() {
    if (!this.data.isMember) {
      wx.showModal({
        title: '会员专属功能',
        content: '「家庭共享邀请」是会员专属功能，开通会员后即可邀请家人共记一本账。',
        confirmText: '去看看',
        cancelText: '再想想',
        success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/member/member-home' }); },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/share/share-invite' });
  },

  onMembers() {
    wx.navigateTo({ url: '/pages/share/share-members' });
  },

  onViewShare(e) {
    const ownerId = e.currentTarget.dataset.owner;
    wx.navigateTo({ url: `/pages/share/share-view?ownerId=${ownerId}` });
  },
});
