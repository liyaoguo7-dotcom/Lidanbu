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
    const [m, received, isAdmin] = await Promise.all([
      dataService.getMembership().catch(() => null),
      dataService.myReceivedShares().catch(() => []),
      dataService.isAdmin().catch(() => false),
    ]);
    this.setData({
      // 管理员免会员（2026-10-30）：管理员可直接发起家庭共享邀请。
      isMember: !!((m && (m.state === 'member' || m.state === 'grace')) || isAdmin),
      received,
    });
  },

  /** 邀请家人：会员专属；非会员被邀请人点此不跳转、不弹窗，只出轻提示（2026-10-31） */
  onInvite() {
    if (!this.data.isMember) {
      wx.showToast({ title: '请开通会员邀请家人', icon: 'none', duration: 1500 });
      return;
    }
    wx.navigateTo({ url: '/pages/share/share-invite' });
  },

  /** 成员管理：与邀请家人同门禁；非会员只出轻提示、不跳转（2026-10-31） */
  onMembers() {
    if (!this.data.isMember) {
      wx.showToast({ title: '请开通会员邀请家人', icon: 'none', duration: 1500 });
      return;
    }
    wx.navigateTo({ url: '/pages/share/share-members' });
  },

  onViewShare(e) {
    const ownerId = e.currentTarget.dataset.owner;
    wx.navigateTo({ url: `/pages/share/share-view?ownerId=${ownerId}` });
  },
});
