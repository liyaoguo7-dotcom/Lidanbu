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
    // 2026-11-01 收到共享改名：正在改名的 membershipId 与输入值
    editingId: '',
    editingName: '',
  },

  touchStartX: 0,
  _swipeW: 112, // 收礼礼簿行同款：修改56 + 删除56

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
      // 2026-11-01：收到列表已按主人去重（服务端），每条带 offset 供左滑用
      received: (received || []).map((r) => ({ ...r, offset: 0 })),
    });
  },

  async _reloadReceived() {
    try {
      const received = await dataService.myReceivedShares();
      this.setData({ received: (received || []).map((r) => ({ ...r, offset: 0 })) });
    } catch (e) { /* 保持旧列表，错误由调用方提示 */ }
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

  // ---- 收到共享：左滑（收礼礼簿行同款）----
  onTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    const id = e.currentTarget.dataset.id;
    this.setData({ received: this.data.received.map((r) => (r.membershipId === id ? r : { ...r, offset: 0 })) });
  },
  onTouchMove(e) {
    const id = e.currentTarget.dataset.id;
    const dx = e.touches[0].clientX - this.touchStartX;
    const offset = Math.max(-this._swipeW, Math.min(0, dx));
    this.setData({ received: this.data.received.map((r) => (r.membershipId === id ? { ...r, offset } : r)) });
  },
  onTouchEnd(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      received: this.data.received.map((r) => (r.membershipId === id
        ? { ...r, offset: r.offset < -this._swipeW / 2 ? -this._swipeW : 0 } : r)),
    });
  },

  // ---- 收到共享：右边“⋯”与左滑改删同一入口 ----
  onMoreReceived(e) {
    const id = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['修改名称', '删除退出'],
      success: (res) => {
        if (res.tapIndex === 0) this._startRename(id);
        else if (res.tapIndex === 1) this._leaveReceived(id);
      },
    });
  },
  onEditReceived(e) {
    this._startRename(e.currentTarget.dataset.id);
  },
  _startRename(id) {
    const item = this.data.received.find((r) => r.membershipId === id);
    if (!item) return;
    this.setData({
      received: this.data.received.map((r) => ({ ...r, offset: 0 })),
      editingId: id,
      // 已自定名回填，默认名不回填（空则保存后回默认“我收到的共享”）
      editingName: item.receivedName || '',
    });
  },
  onEditingNameInput(e) {
    this.setData({ editingName: e.detail.value || '' });
  },
  onCancelReceivedName() {
    this.setData({ editingId: '', editingName: '' });
  },
  async onSaveReceivedName() {
    const id = this.data.editingId;
    if (!id) return;
    wx.showLoading({ title: '保存中' });
    try {
      await dataService.updateReceivedName(id, this.data.editingName || '');
      wx.hideLoading();
      this.setData({ editingId: '', editingName: '' });
      await this._reloadReceived();
      wx.showToast({ title: '已生效', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: '保存失败', content: e.message, showCancel: false });
    }
  },
  onLeaveReceived(e) {
    // 左滑删除与“⋯”删除同一入口；e 可能是事件或直接传 id
    const id = typeof e === 'string' ? e : e.currentTarget.dataset.id;
    this._leaveReceived(id);
  },
  _leaveReceived(id) {
    if (!id) return;
    wx.showModal({
      title: '退出共享',
      content: '确定要退出这份共享吗？退出后主人成员列表不再列出你，你已加的记录仍留在主人账本。',
      confirmText: '退出',
      confirmColor: '#F0575A',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '退出中' });
        try {
          await dataService.memberLeave(id);
          wx.hideLoading();
          this.setData({ editingId: '', editingName: '' });
          await this._reloadReceived();
          wx.showToast({ title: '已退出共享', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          wx.showModal({ title: '退出失败', content: e.message, showCancel: false });
        }
      },
    });
  },
});
