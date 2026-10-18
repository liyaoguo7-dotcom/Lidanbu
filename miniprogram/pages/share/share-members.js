/**
 * 礼单簿 · 成员管理（阶段3）
 * 成员列表 → 点成员进"权限详情页"
 */
const dataService = require('../../services/data-service.js');

const SWITCH_NAMES = { view: '仅查看', add: '可新增', edit: '可修改', del: '可删除', export: '可导出' };

Page({
  data: { members: [] },

  async onLoad() {
    await dataService.init();
  },

  async onShow() {
    wx.showLoading({ title: '' });
    try {
      const list = await dataService.listMembers();
      this.setData({
        members: list.map((m) => ({
          membershipId: m._id,
          name: m.memberId ? '家人' : '待接受邀请',
          status: m.status,
          switchesText: Object.keys(SWITCH_NAMES)
            .filter((k) => m.grant && m.grant.switches && m.grant.switches[k])
            .map((k) => SWITCH_NAMES[k]).join('、'),
        })),
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onMember(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/share/share-grant?membershipId=${id}` });
  },
});
