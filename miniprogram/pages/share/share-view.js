/**
 * 礼单簿 · XX的账本（家人视角，阶段3）
 * 顶部"正在查看：XX的账本" + 淡字"仅统计已授权给你的记录"
 * 只用已授权数据计算（经 core.stats.memberStats）
 */
const dataService = require('../../services/data-service.js');
const { formatAmountInt } = require('../../core/format.js');

Page({
  data: {
    ownerId: '',
    ownerName: '家人',
    events: [],
    wanglai: [],
    totalIn: '0.00',
    totalOut: '0.00',
  },

  async onLoad(query) {
    await dataService.init();
    let ownerId = query.ownerId || '';
    // 分享卡片落地：带 code（邀请码=membershipId）→ 先接受邀请再看账本（2026-10-22 邀请改走微信分享）
    if (query.code) {
      ownerId = (await this.acceptByCode(query.code)) || ownerId;
    }
    this.setData({ ownerId });
    await this.refresh();
  },

  /** 凭邀请码接受家庭共享邀请，返回账本主人 id（失败返回 ''） */
  async acceptByCode(code) {
    try {
      const ms = await dataService.getShareMembership(code);
      if (!ms) {
        wx.showToast({ title: '邀请不存在或已失效', icon: 'none' });
        return '';
      }
      const myId = dataService.getMyUserId();
      if (ms.ownerId === myId) {
        wx.showToast({ title: '这是你发出的邀请', icon: 'none' });
        return ms.ownerId;
      }
      if (ms.status === 'pending') {
        await dataService.acceptShare(code);
        wx.showToast({ title: '已接受邀请', icon: 'success' });
      } else if (ms.memberId && ms.memberId !== myId) {
        wx.showToast({ title: '这份邀请已被其他人接受', icon: 'none' });
        return '';
      }
      return ms.ownerId;
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
      return '';
    }
  },

  async refresh() {
    const ownerId = this.data.ownerId;
    if (!ownerId) return;
    wx.showLoading({ title: '' });
    try {
      const [events, list] = await Promise.all([
        dataService.listMemberEvents(ownerId).catch(() => []),
        dataService.getWanglaiList({ ownerId, range: { opt: 'lastYear' } }).catch(() => ({ rows: [], totalReceiveFen: 0, totalGiftFen: 0 })),
      ]);
      this.setData({
        events: events || [],
        wanglai: (list.rows || []).slice(0, 20),
        totalIn: formatAmountInt(list.totalReceiveFen || 0),
        totalOut: formatAmountInt(list.totalGiftFen || 0),
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
});
