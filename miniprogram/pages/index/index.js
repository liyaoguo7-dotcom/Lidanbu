/**
 * 礼单簿 · 首页（阶段2 2A）
 * 顶部 4 金刚区 + 中部送礼/收礼 2 大卡；小喇叭文案按用户决定。
 * 家庭共享/拍照导入为会员专属，普通用户点进会员介绍。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    tipText: '点击拍照导入，可一键识别纸质礼单',
    entries: [
      { id: 'share', icon: '/images/icons/family.svg', name: '家庭共享' },
      { id: 'photo', icon: '/images/icons/camera.svg', name: '拍照导入' },
      { id: 'invite', icon: '/images/icons/mail.svg', name: '电子请柬' },
      { id: 'export', icon: '/images/icons/export.svg', name: '导出备份' },
    ],
    isMember: false,
  },

  async onLoad() {
    await dataService.init();
    await this.refreshMember();
  },

  async onShow() {
    await this.refreshMember();
  },

  async refreshMember() {
    try {
      const m = await dataService.getMembership();
      this.setData({ isMember: m.state === 'member' || m.state === 'grace' });
    } catch (e) { /* 演示期忽略 */ }
  },

  memberOnly(feature) {
    const labels = { share: '家庭共享邀请', photo: '拍照导入' };
    wx.showModal({
      title: '会员专属功能',
      content: `「${labels[feature] || feature}」是会员专属功能，开通会员后即可使用。`,
      confirmText: '去看看',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) wx.switchTab({ url: '/pages/mine/mine' });
      },
    });
  },

  /** 电子请柬：跳转合作小程序（自制请柬已取消）；未配置目标时提示敬请期待 */
  goExternalInvitation() {
    const ext = dataService.getExternalInvitation();
    if (!ext || !ext.appId) {
      wx.showToast({ title: '敬请期待', icon: 'none' });
      return;
    }
    wx.navigateToMiniProgram({ appId: ext.appId, path: '' });
  },

  onEntry(e) {
    const id = e.currentTarget.dataset.id;
    if ((id === 'share' || id === 'photo') && !this.data.isMember) {
      this.memberOnly(id);
      return;
    }
    if (id === 'share') { wx.navigateTo({ url: '/pages/share/share-home' }); return; }
    if (id === 'photo') { wx.navigateTo({ url: '/pages/import/import-home' }); return; }
    if (id === 'invite') { this.goExternalInvitation(); return; }
    if (id === 'export') { wx.navigateTo({ url: '/pages/export/export-home' }); return; }
  },

  goGifts() {
    wx.navigateTo({ url: '/pages/gifts/gifts' });
  },

  goReceive() {
    wx.navigateTo({ url: '/pages/receive/receive' });
  },
});
