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
      { id: 'share', icon: '👨‍👩‍👧', name: '家庭共享' },
      { id: 'photo', icon: '📷', name: '拍照导入' },
      { id: 'invite', icon: '💌', name: '电子请柬' },
      { id: 'export', icon: '💾', name: '导出备份' },
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

  onEntry(e) {
    const id = e.currentTarget.dataset.id;
    if ((id === 'share' || id === 'photo') && !this.data.isMember) {
      this.memberOnly(id);
      return;
    }
    if (id === 'share') { wx.showToast({ title: '家庭共享（阶段3）', icon: 'none' }); return; }
    if (id === 'photo') { wx.navigateTo({ url: '/pages/import/import-home' }); return; }
    if (id === 'invite') { wx.showToast({ title: '电子请柬（阶段4）', icon: 'none' }); return; }
    if (id === 'export') { wx.showToast({ title: '导出备份（阶段3）', icon: 'none' }); return; }
  },

  goGifts() {
    wx.navigateTo({ url: '/pages/gifts/gifts' });
  },

  goReceive() {
    wx.navigateTo({ url: '/pages/receive/receive' });
  },
});
