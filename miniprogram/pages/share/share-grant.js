/**
 * 礼单簿 · 成员权限详情页（阶段3）
 * 随时可改、立即生效；底部红色"移除成员"（需确认，记录保留）
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    membershipId: '',
    switches: [],
    events: [],
    giftsOn: false,
    dirty: false,
  },

  async onLoad(query) {
    await dataService.init();
    const membershipId = query.membershipId || '';
    const [grant, summary] = await Promise.all([
      dataService.getGrant(membershipId),
      dataService.exportSummary(),
    ]);
    const switches = dataService.getShareSwitches().map((s) => ({
      id: s.id, name: s.name, alwaysOn: !!s.alwaysOn,
      on: grant && grant.switches ? !!grant.switches[s.id] || s.id === 'view' : (s.id === 'view' || !!s.defaultOn),
    }));
    const inScope = (grant && grant.scope && grant.scope.events) || [];
    this.setData({
      membershipId,
      switches,
      giftsOn: !!(grant && grant.scope && grant.scope.gifts),
      events: (summary.events || []).map((e) => ({ _id: e._id, name: e.name, checked: inScope.includes(e._id) })),
    });
  },

  _markDirty() { this.setData({ dirty: true }); },

  onSwitchToggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      switches: this.data.switches.map((s) => (s.id === id && !s.alwaysOn) ? { ...s, on: !s.on } : s),
      dirty: true,
    });
  },

  onEventToggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      events: this.data.events.map((ev) => ev._id === id ? { ...ev, checked: !ev.checked } : ev),
      dirty: true,
    });
  },

  onGiftsToggle() { this.setData({ giftsOn: !this.data.giftsOn, dirty: true }); },

  async onSave() {
    const switches = {};
    this.data.switches.forEach((s) => { switches[s.id] = s.on; });
    wx.showLoading({ title: '保存中' });
    try {
      await dataService.updateGrant(this.data.membershipId, {
        switches,
        scope: {
          events: this.data.events.filter((e) => e.checked).map((e) => e._id),
          gifts: this.data.giftsOn,
        },
      });
      wx.hideLoading();
      this.setData({ dirty: false });
      wx.showToast({ title: '已生效', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: '保存失败', content: e.message, showCancel: false });
    }
  },

  onRemove() {
    wx.showModal({
      title: '移除成员',
      content: '确定要移除这位成员吗？\n\n他/她之前新增的记录会保留在你的账本中，仍显示是谁加的。',
      confirmText: '移除',
      confirmColor: '#F0575A',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '移除中' });
        try {
          await dataService.removeMember(this.data.membershipId);
          wx.hideLoading();
          wx.showToast({ title: '已移除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (e) {
          wx.hideLoading();
          wx.showModal({ title: '移除失败', content: e.message, showCancel: false });
        }
      },
    });
  },
});
