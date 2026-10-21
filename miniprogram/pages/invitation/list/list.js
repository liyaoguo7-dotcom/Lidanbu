/**
 * 礼单簿 · 我的请柬列表（阶段4）
 * 点条目进预览；行内可进回执统计/编辑/删除（删除走统一弹窗，连带回执）。
 */
const dataService = require('../../../services/data-service.js');

Page({
  data: {
    list: [],
    loaded: false,
    showDelModal: false,
    delId: '',
    delContent: '',
  },

  async onShow() {
    await dataService.init();
    await this.load();
  },

  async load() {
    try {
      const raw = await dataService.listInvitations();
      const list = raw.map((inv) => {
        const style = dataService.getInvitationStyle(inv.styleId);
        return {
          ...inv,
          typeName: dataService.invitationTypeName(inv.type),
          stylePrimary: style.colors.primary,
          dateText: inv.eventTime ? `${inv.eventDate} ${inv.eventTime}` : inv.eventDate,
        };
      });
      this.setData({ list, loaded: true });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ loaded: true });
    }
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/invitation/edit/edit' });
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/invitation/preview/preview?id=${e.currentTarget.dataset.id}` });
  },

  onStats(e) {
    wx.navigateTo({ url: `/pages/invitation/stats/stats?id=${e.currentTarget.dataset.id}` });
  },

  onEdit(e) {
    wx.navigateTo({ url: `/pages/invitation/edit/edit?id=${e.currentTarget.dataset.id}` });
  },

  onDelete(e) {
    const item = this.data.list.find((x) => x._id === e.currentTarget.dataset.id);
    if (!item) return;
    this.setData({
      showDelModal: true,
      delId: item._id,
      delContent: `${item.title}\n将同时删除 ${item.rsvpCount || 0} 条回执记录`,
    });
  },

  onDelCancel() {
    this.setData({ showDelModal: false, delId: '' });
  },

  async onDelConfirm() {
    const id = this.data.delId;
    this.setData({ showDelModal: false, delId: '' });
    try {
      await dataService.deleteInvitation(id);
      wx.showToast({ title: '已删除', icon: 'none' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});
