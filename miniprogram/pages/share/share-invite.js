/**
 * 礼单簿 · 发起邀请（2026-10-22 改版：走真实微信联系人）
 * 流程：勾 5 开关（仅查看恒开不可取消）→ 选范围（至少一个收礼事件或"送礼"）
 *   → 点「生成邀请」调 core.share.invite 拿到邀请码（= membershipId，不绑定任何亲友，
 *     谁接受谁绑定）→ 页面出现 open-type="share" 红色按钮，发给真实微信好友；
 *     对方点开分享卡片进入 share-view?code=邀请码 即完成接受。
 * 旧流程「先从亲友录 picker 选人」已删除（用户真机反馈：邀请应走微信联系人）。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    switches: [],   // [{id,name,alwaysOn,on}]
    events: [],     // [{_id,name,checked}]
    giftsOn: false,
    inviteCode: '', // 生成后 = membershipId
  },

  async onLoad() {
    await dataService.init();
    const summary = await dataService.exportSummary();
    const switches = dataService.getShareSwitches().map((s) => ({
      id: s.id, name: s.name, alwaysOn: !!s.alwaysOn, on: s.id === 'view' ? true : !!s.defaultOn,
    }));
    this.setData({
      switches,
      events: (summary.events || []).map((e) => ({ _id: e._id, name: e.name, checked: false })),
    });
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

  /** 生成邀请：校验范围 → 建 pending 邀请 → 拿到邀请码（之后改勾选需重新生成） */
  async onCreate() {
    const eventIds = this.data.events.filter((e) => e.checked).map((e) => e._id);
    if (eventIds.length === 0 && !this.data.giftsOn) {
      wx.showToast({ title: '至少勾选一个收礼事件或"送礼"才能发出', icon: 'none' });
      return;
    }
    const switches = {};
    this.data.switches.forEach((s) => { switches[s.id] = s.on; });
    wx.showLoading({ title: '生成中' });
    try {
      const r = await dataService.shareInvite({
        switches,
        scope: { events: eventIds, gifts: this.data.giftsOn },
      });
      wx.hideLoading();
      this.setData({ inviteCode: r.membershipId });
      wx.showToast({ title: '邀请已生成', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: '生成失败', content: e.message, showCancel: false });
    }
  },

  /** 分享给微信好友：path 带邀请码，落地页 share-view 凭码接受 */
  onShareAppMessage() {
    const code = this.data.inviteCode || '';
    return {
      title: '邀请你来共同记录人情往来——礼单簿家庭共享',
      path: code ? `/pages/share/share-view?code=${code}` : '/pages/share/share-home',
    };
  },
});
