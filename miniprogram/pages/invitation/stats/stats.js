/**
 * 礼单簿 · 请柬回执统计（阶段4，仅主人）
 * 汇总：参加组数/参加人数合计/不参加/未定；名单逐条带出席状态；
 *「参加」的客人可一键加入亲友录（core 走 contacts 正规创建，
 * 重名只提醒不合并，加完回填 contactId 防重复）。
 */
const dataService = require('../../../services/data-service.js');

Page({
  data: {
    stats: null,
    list: [],
    title: '',
    notFound: false,
  },

  async onLoad(options) {
    this._id = options.id || '';
    await dataService.init();
    await this.load();
  },

  async load() {
    try {
      const s = await dataService.getRsvpStats(this._id);
      const list = s.list.map((r) => ({
        ...r,
        attendName: dataService.invitationAttendName(r.attend),
      }));
      this.setData({ stats: s, list, title: s.invitation.title });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ notFound: true });
    }
  },

  async onAddContact(e) {
    const rsvpId = e.currentTarget.dataset.id;
    try {
      const r = await dataService.addRsvpGuestToContacts(this._id, rsvpId);
      if (r.alreadyAdded) {
        wx.showToast({ title: '这位亲友已在亲友录里', icon: 'none' });
      } else if (r.duplicateWarning) {
        wx.showToast({ title: '亲友录里已有同名亲友，已分开保存', icon: 'none' });
      } else {
        wx.showToast({ title: '已加入亲友录', icon: 'none' });
      }
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onPreview() {
    wx.navigateTo({ url: `/pages/invitation/preview/preview?id=${this._id}` });
  },

  onShareAppMessage() {
    return {
      title: this.data.title || '邀请函',
      path: `/pages/invitation/guest/guest?id=${this._id}`,
    };
  },
});
