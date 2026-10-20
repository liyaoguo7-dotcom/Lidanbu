/**
 * 礼单簿 · 「请横屏」独立页
 *
 * 用途：从竖屏入口（如会员专属区）先进本页时，竖屏只显示提示（文案与定版图 30 逐字一致）；
 * 用户把手机转成横屏 → onResize 触发 → 自动跳到真正的横置礼单本（receive/gift）。
 * 横置页内部的竖屏态用的是同一套文案（book.wxml 模板内），两处口径一致。
 * 门禁与横置页相同：非会员跳会员介绍页。
 */
const dataService = require('../../../services/data-service.js');
const landscapeRoute = require('../../../services/landscape-route.js');
const { ROTATE_COPY } = require('../landscape-core.js');

Page({
  data: { copy: ROTATE_COPY },

  _target: 'receive',
  _eventId: '',
  _ownerId: '',

  async onLoad(options) {
    this._target = options.target === 'gift' ? 'gift' : 'receive';
    this._eventId = options.eventId || '';
    this._ownerId = options.ownerId || '';
    await dataService.init();
    const m = await dataService.getMembership();
    if (m.state !== 'member' && m.state !== 'grace') {
      wx.showToast({ title: '横置礼单本是会员专属功能', icon: 'none' });
      wx.redirectTo({ url: '/pages/member/member-home' });
      return;
    }
    // 进页时已经是横屏（少见，如从横屏页跳转过来）→ 直接进礼单本
    try {
      const info = wx.getWindowInfo();
      if (info.windowWidth > info.windowHeight) this._goBook();
    } catch (e) { /* 忽略，留在本页等转屏 */ }
  },

  onResize(res) {
    const size = (res && res.size) || {};
    if (size.windowWidth > size.windowHeight) this._goBook();
  },

  _goBook() {
    const q = [];
    if (this._eventId) q.push(`eventId=${this._eventId}`);
    if (this._ownerId) q.push(`ownerId=${this._ownerId}`);
    wx.redirectTo({ url: `/pages/landscape/${this._target}/${this._target}${q.length ? '?' + q.join('&') : ''}` });
  },

  goBack() {
    wx.navigateBack({ delta: 1, fail: () => this.goPortrait() });
  },

  /** 「切换回竖置样式」：回普通竖置礼单（不丢数据、不影响会员状态）；
   *  同时把横置开关写回关闭，避免下次又被开关自动带回横置（mine 开关 onShow 时同步） */
  goPortrait() {
    landscapeRoute.writeLandscapeOn(false);
    if (this._target === 'receive' && this._eventId) {
      wx.redirectTo({ url: `/pages/receive-detail/receive-detail?id=${this._eventId}` });
    } else if (this._target === 'receive') {
      wx.redirectTo({ url: '/pages/receive/receive' });
    } else {
      wx.redirectTo({ url: '/pages/gifts/gifts' });
    }
  },
});
