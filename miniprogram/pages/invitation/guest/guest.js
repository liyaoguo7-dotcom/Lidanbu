/**
 * 礼单簿 · 请柬客人页（阶段4，被邀请人从分享卡片打开）
 * 不需要任何身份绑定即可查看与填回执；提交时以当前用户标识作 guestKey
 *（云环境即真实 openid）尽力去重——重复提交更新同一条回执。
 */
const dataService = require('../../../services/data-service.js');
const { buildCard } = require('../card-view.js');

Page({
  data: {
    inv: null,
    card: null,
    notFound: false,
    attendOptions: [],
    form: { guestName: '', attend: 'attend', count: 1, note: '' },
    submitted: false,
    submitting: false,
  },

  async onLoad(options) {
    this._id = options.id || '';
    await dataService.init();
    this.setData({ attendOptions: dataService.getAttendOptions() });
    await this.load();
  },

  async load() {
    try {
      const inv = await dataService.getInvitation(this._id);
      if (!inv) { this.setData({ notFound: true }); return; }
      this.setData({ inv, card: buildCard(inv) });
      const mine = await dataService.getMyRsvp(this._id);
      if (mine) {
        this.setData({
          form: {
            guestName: mine.guestName, attend: mine.attend,
            count: mine.count > 0 ? mine.count : 1, note: mine.note || '',
          },
          submitted: true,
        });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ notFound: true });
    }
  },

  onNameInput(e) { this.setData({ 'form.guestName': e.detail.value }); },
  onAttendTap(e) { this.setData({ 'form.attend': e.currentTarget.dataset.id }); },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }); },
  onMinus() {
    const n = Math.max(1, (this.data.form.count || 1) - 1);
    this.setData({ 'form.count': n });
  },
  onPlus() {
    const n = Math.min(50, (this.data.form.count || 1) + 1);
    this.setData({ 'form.count': n });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const r = await dataService.submitRsvp(this._id, this.data.form);
      this.setData({ submitted: true });
      wx.showToast({ title: r.updated ? '回执已更新' : '回执已提交，谢谢！', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 客人也能继续转发这份请柬 */
  onShareAppMessage() {
    const inv = this.data.inv || {};
    return {
      title: inv.title || '邀请函',
      path: `/pages/invitation/guest/guest?id=${this._id}`,
    };
  },
});
