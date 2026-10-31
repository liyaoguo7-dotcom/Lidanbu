/**
 * 礼单簿 · 成员管理（阶段3）
 * 成员列表 → 点成员进"权限详情页"
 * 2026-10-31 清理：已接受与待接受分开展示；已接受主名按备注＞真实昵称＞礼友＋数字，
 *   副行含权限文案＋接受时间（旧记录无 acceptedAt 时用发出时间兜底并如实说明）；
 *   待接受含发出时间＋范围摘要，点进详情可删除／作废（二次确认，见 share-grant）；
 *   已移除与超 48 小时失效的服务端已不再返回（惰性失效标 expired，不真删库）。
 */
const dataService = require('../../services/data-service.js');

const SWITCH_NAMES = { view: '仅查看', add: '可新增', edit: '可修改', del: '可删除', export: '可导出' };

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleDateString('zh-CN') : '';
}

Page({
  data: { accepted: [], pending: [] },

  async onLoad() {
    await dataService.init();
  },

  async onShow() {
    wx.showLoading({ title: '' });
    try {
      const list = await dataService.listMembers();
      const accepted = [];
      const pending = [];
      for (const m of list) {
        const switchesText = Object.keys(SWITCH_NAMES)
          .filter((k) => m.grant && m.grant.switches && m.grant.switches[k])
          .map((k) => SWITCH_NAMES[k]).join('、');
        if (m.status === 'active') {
          accepted.push({
            membershipId: m._id,
            name: (m.remark || m.memberName || '家人'),
            switchesText,
            timeText: m.acceptedAt
              ? `接受于 ${fmtDate(m.acceptedAt)}`
              : `发出于 ${fmtDate(m.createdAt)}（旧记录，接受时间未记录）`,
          });
        } else if (m.status === 'pending') {
          pending.push({
            membershipId: m._id,
            name: (m.remark || '待接受邀请'),
            switchesText,
            timeText: `发出于 ${fmtDate(m.createdAt)}${m.scopeText ? ` · 范围：${m.scopeText}` : ''}`,
          });
        }
      }
      this.setData({ accepted, pending });
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
