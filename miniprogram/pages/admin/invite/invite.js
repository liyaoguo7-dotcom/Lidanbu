/**
 * 老板平台 · 邀请奖励（设置与数据同页，2026-10-25 用户定：上设置下数据）
 * 上：开关、每邀请奖励（收礼池/送礼）、成功邀请上限——经
 * core.admin.updateInviteSettings 修改并覆盖静态默认，记入操作记录。
 * 下：数据只看数量（邀请人数、成功邀请次数、已发放额度）。
 * 本页合并了原配置管理里的「邀请奖励设置」节，配置页不再有该节。
 */
const ds = require('../../../services/data-service.js');

function parseCount(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label}请填不小于 0 的整数`);
  return n;
}

Page({
  data: {
    stats: null, loading: true, saving: false,
    inviteCfg: { enabled: true, receivePool: '', giftRecords: '', maxSuccessfulInvites: '' },
  },
  async onShow() {
    this.setData({ loading: true });
    try {
      const cfg = await ds.adminGetConfig();
      const ir = (cfg && cfg.inviteReward) || {};
      this.setData({
        inviteCfg: {
          enabled: ir.enabled !== false,
          receivePool: String(ir.perInvite ? ir.perInvite.receivePool : ''),
          giftRecords: String(ir.perInvite ? ir.perInvite.giftRecords : ''),
          maxSuccessfulInvites: String(ir.maxSuccessfulInvites != null ? ir.maxSuccessfulInvites : ''),
        },
      });
    } catch (e) { /* 配置读不到时保留默认，保存时服务端会再校验 */ }
    try {
      const stats = await ds.adminInviteStats();
      this.setData({ stats, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
  onInviteToggle(e) {
    this.setData({ 'inviteCfg.enabled': e.detail.value });
  },
  onInviteInput(e) {
    this.setData({ [`inviteCfg.${e.currentTarget.dataset.key}`]: e.detail.value });
  },
  onSaveInvite() {
    let payload;
    try {
      payload = {
        enabled: !!this.data.inviteCfg.enabled,
        perInvite: {
          receivePool: parseCount(this.data.inviteCfg.receivePool, '收礼池奖励'),
          giftRecords: parseCount(this.data.inviteCfg.giftRecords, '送礼奖励'),
        },
        maxSuccessfulInvites: parseCount(this.data.inviteCfg.maxSuccessfulInvites, '成功邀请上限'),
      };
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认保存',
      content: '邀请奖励设置保存后立即生效，并记入操作记录，确定吗？',
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ saving: true });
        try {
          await ds.adminUpdateInviteSettings(payload);
          wx.showToast({ title: '已保存，已记入操作记录', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: ds.friendly(err), icon: 'none' });
        } finally {
          this.setData({ saving: false });
        }
      },
    });
  },
});
