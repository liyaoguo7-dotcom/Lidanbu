/**
 * 礼单簿 · 发起邀请（阶段3）
 * 流程：选亲友 → 勾 5 开关（仅查看恒开不可取消）→ 选范围（至少一个收礼事件或"送礼"）→ 发出
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    contacts: [],
    contactId: '',
    contactName: '',
    switches: [],   // [{id,name,alwaysOn,on}]
    events: [],     // [{_id,name,checked}]
    giftsOn: false,
  },

  async onLoad() {
    await dataService.init();
    const [contacts, summary] = await Promise.all([
      dataService.listContacts(),
      dataService.exportSummary(),
    ]);
    const switches = dataService.getShareSwitches().map((s) => ({
      id: s.id, name: s.name, alwaysOn: !!s.alwaysOn, on: s.id === 'view' ? true : !!s.defaultOn,
    }));
    this.setData({
      contacts,
      switches,
      events: (summary.events || []).map((e) => ({ _id: e._id, name: e.name, checked: false })),
    });
  },

  onContactChange(e) {
    const idx = Number(e.detail.value);
    const c = this.data.contacts[idx];
    this.setData({ contactId: c._id, contactName: c.name });
  },

  onSwitchToggle(e) {
    const id = e.currentTarget.dataset.id;
    const switches = this.data.switches.map((s) => {
      if (s.id !== id || s.alwaysOn) return s;
      return { ...s, on: !s.on };
    });
    this.setData({ switches });
  },

  onEventToggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      events: this.data.events.map((ev) => ev._id === id ? { ...ev, checked: !ev.checked } : ev),
    });
  },

  onGiftsToggle() {
    this.setData({ giftsOn: !this.data.giftsOn });
  },

  async onSend() {
    if (!this.data.contactId) {
      wx.showToast({ title: '请先选择一位亲友', icon: 'none' });
      return;
    }
    const eventIds = this.data.events.filter((e) => e.checked).map((e) => e._id);
    if (eventIds.length === 0 && !this.data.giftsOn) {
      wx.showToast({ title: '至少勾选一个收礼事件或"送礼"才能发出', icon: 'none' });
      return;
    }
    const switches = {};
    this.data.switches.forEach((s) => { switches[s.id] = s.on; });
    wx.showLoading({ title: '发出中' });
    try {
      await dataService.shareInvite({
        switches,
        scope: { events: eventIds, gifts: this.data.giftsOn },
      });
      wx.hideLoading();
      wx.showModal({
        title: '邀请已发出',
        content: `已向「${this.data.contactName}」发出邀请，对方接受后即可查看你标记的项目。`,
        showCancel: false,
        confirmText: '知道了',
        success: () => wx.navigateBack(),
      });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: '发出失败', content: e.message, showCancel: false });
    }
  },
});
