/**
 * 礼单簿 · 请柬预览（阶段4，主人视角）
 * 按所选风格渲染请柬正页；分享按钮走 onShareAppMessage 带 invitationId，
 * 朋友打开落到 guest 页。分享卡片标题=请柬标题，封面用风格示意
 *（页面内文字卡，不调 canvas）。
 */
const dataService = require('../../../services/data-service.js');
const { buildCard } = require('../card-view.js');

Page({
  data: { inv: null, card: null, notFound: false },

  async onLoad(options) {
    this._id = options.id || '';
    await dataService.init();
    await this.load();
  },

  async load() {
    try {
      const inv = await dataService.getInvitation(this._id);
      if (!inv) { this.setData({ notFound: true }); return; }
      this.setData({ inv, card: buildCard(inv) });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ notFound: true });
    }
  },

  onStats() {
    wx.navigateTo({ url: `/pages/invitation/stats/stats?id=${this._id}` });
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/invitation/edit/edit?id=${this._id}` });
  },

  /** 分享给朋友：标题用请柬标题，路径带 id 落到客人页 */
  onShareAppMessage() {
    const inv = this.data.inv || {};
    return {
      title: inv.title || '邀请函',
      path: `/pages/invitation/guest/guest?id=${this._id}`,
    };
  },
});
