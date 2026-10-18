/**
 * 老板平台 · 会员管理（阶段5第2项）
 * 列表只含白名单字段：脱敏 userId、会员状态、到期时间、各集合条数。
 * 手动开通/延期走 setMemberPlan，操作写入 audit 操作记录。
 */
const ds = require('../../services/data-service.js');

const STATE_NAMES = { free: '免费', member: '会员', grace: '缓冲期', expired: '已过期' };

Page({
  data: {
    filters: [
      { id: '', name: '全部' },
      { id: 'member', name: '会员' },
      { id: 'free', name: '免费' },
      { id: 'grace', name: '缓冲期' },
      { id: 'expired', name: '已过期' },
    ],
    filter: '',
    list: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    loading: false,
    // 开通/延期面板
    grantUser: null,
    grantDays: '365',
  },

  onLoad() { this.reload(); },

  async reload() {
    this.setData({ page: 1, list: [], loading: true });
    await this.fetchPage(1);
  },

  async fetchPage(p) {
    const { filter, pageSize, list } = this.data;
    try {
      const r = await ds.adminMemberList({ page: p, pageSize, memberState: filter || undefined });
      const merged = p === 1 ? r.items : list.concat(r.items);
      this.setData({
        list: merged.map((u) => ({ ...u, stateName: STATE_NAMES[u.memberState] || u.memberState })),
        total: r.total,
        page: r.page,
        hasMore: merged.length < r.total,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.id });
    this.reload();
  },

  onMore() {
    if (this.data.hasMore && !this.data.loading) {
      this.setData({ loading: true });
      this.fetchPage(this.data.page + 1);
    }
  },

  onGrant(e) {
    this.setData({ grantUser: e.currentTarget.dataset.user, grantDays: '365' });
  },

  onCancelGrant() { this.setData({ grantUser: null }); },

  onDaysInput(e) { this.setData({ grantDays: e.detail.value }); },

  async onConfirmGrant() {
    const { grantUser, grantDays } = this.data;
    const days = parseInt(grantDays, 10);
    if (!Number.isInteger(days) || days < 1 || days > 1095) {
      wx.showToast({ title: '天数须为 1~1095 的整数', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认开通',
      content: `为 ${grantUser.userId} 开通会员 ${days} 天？操作将记入操作记录。`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await ds.adminSetMemberPlan(grantUser.userId, 'manual', days);
          wx.showToast({ title: '已开通', icon: 'success' });
          this.setData({ grantUser: null });
          this.reload();
        } catch (e) {
          wx.showToast({ title: ds.friendly(e), icon: 'none' });
        }
      },
    });
  },
});
