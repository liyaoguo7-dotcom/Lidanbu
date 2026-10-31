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
    remark: '', // 2026-10-31：邀请人备注（选填、只邀请人可见、不改被邀请人昵称、限 16 字）
    isPending: false, // 待接受邀请：底部按钮文案为"作废邀请"，已接受则为"移除成员"
  },

  async onLoad(query) {
    await dataService.init();
    const membershipId = query.membershipId || '';
    const [grant, summary, ms] = await Promise.all([
      dataService.getGrant(membershipId),
      dataService.exportSummary(),
      dataService.getShareMembership(membershipId).catch(() => null),
    ]);
    this._remarkLoaded = !!ms;
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
      remark: (ms && typeof ms.remark === 'string') ? ms.remark : '',
      isPending: !!(ms && ms.status === 'pending'),
    });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value || '', dirty: true });
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
    if (this._saving) return; // 在途锁（任务AE补修）
    this._saving = true;
    const switches = {};
    this.data.switches.forEach((s) => { switches[s.id] = s.on; });
    wx.showLoading({ title: '保存中' });
    try {
      const payload = {
        switches,
        scope: {
          events: this.data.events.filter((e) => e.checked).map((e) => e._id),
          gifts: this.data.giftsOn,
        },
      };
      // 备注只在成功读到成员关系时同批保存（读不到时不带备注，避免误清已有备注）
      if (this._remarkLoaded) payload.remark = this.data.remark || '';
      await dataService.updateGrant(this.data.membershipId, payload);
      wx.hideLoading();
      this.setData({ dirty: false });
      wx.showToast({ title: '已生效', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: '保存失败', content: e.message, showCancel: false });
    } finally { this._saving = false; }
  },

  onRemove() {
    const isPending = this.data.isPending;
    wx.showModal({
      title: isPending ? '作废邀请' : '移除成员',
      content: isPending
        ? '确定要作废这份待接受邀请吗？作废后对方点旧卡会提示邀请已失效。'
        : '确定要移除这位成员吗？\n\n他/她之前新增的记录会保留在你的账本中，仍显示是谁加的。',
      confirmText: isPending ? '作废' : '移除',
      confirmColor: '#F0575A',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: isPending ? '作废中' : '移除中' });
        try {
          await dataService.removeMember(this.data.membershipId);
          wx.hideLoading();
          wx.showToast({ title: isPending ? '已作废' : '已移除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (e) {
          wx.hideLoading();
          wx.showModal({ title: isPending ? '作废失败' : '移除失败', content: e.message, showCancel: false });
        }
      },
    });
  },
});
