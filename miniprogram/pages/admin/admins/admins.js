/**
 * 老板平台 · 管理员账号、权限与操作记录（第10项）
 * 名单分两档（2026-10-24 用户定）：云端后台导入的管理员（console）只有
 * 这一档可以增减管理员；应用内添加的（added）能用老板平台但不能增减。
 * 加人在「账号查询」用户列表里点「设为管理员」；移除在本页（带护栏：
 * 服务端拦最后一位云端管理员，每次增减写操作记录）。
 * 操作记录 = AuditLog 查询，可按动作类型过滤，操作者一律脱敏。
 */
const ds = require('../../../services/data-service.js');

const ACTION_NAMES = {
  config: '修改配置', grant: '开通会员', payment: '支付', refund: '退款',
  feedback: '处理反馈', restrict: '限制用户', unrestrict: '解除限制',
  create: '新增', update: '修改', delete: '删除', share: '家庭共享', export: '导出',
  'admin-add': '添加管理员', 'admin-remove': '移除管理员',
};

Page({
  data: { admins: [], canManage: false, action: '', list: [], total: 0, loading: false },
  onLoad() { wx.setNavigationBarTitle({ title: '管理员与操作记录' }); },
  onShow() { this.loadAdmins(); this.loadTrail(); },
  onActionInput(e) { this.setData({ action: e.detail.value }); },
  fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  async loadAdmins() {
    try {
      const r = await ds.adminListAdmins();
      this.setData({ admins: r.admins, canManage: !!r.viewerCanManage });
    } catch (e) {
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
  /** 移除管理员（按钮只对云端管理员显示；服务端还有分档与最后一人护栏） */
  onRemoveAdmin(e) {
    const { id, self } = e.currentTarget.dataset;
    if (!id) return;
    wx.showModal({
      title: '移除管理员',
      content: self
        ? '这是你自己。移除后你将立刻失去老板平台权限（名单里还有其他云端管理员时才能移除自己）。确定移除吗？'
        : `确定把 ${id} 移出管理员名单吗？对方将立刻失去老板平台权限。`,
      confirmText: '移除',
      confirmColor: '#F0575A',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const r = await ds.adminRemoveAdmin(id);
          wx.showToast({ title: '已移除', icon: 'none' });
          if (self) {
            setTimeout(() => wx.navigateBack({ delta: 1 }), 900);
            return;
          }
          this.setData({ admins: r.admins, canManage: !!r.viewerCanManage });
          this.loadTrail();
        } catch (err) {
          wx.showToast({ title: ds.friendly(err), icon: 'none' });
        }
      },
    });
  },
  async loadTrail() {
    this.setData({ loading: true });
    try {
      const opts = { page: 1, pageSize: 50 };
      if (this.data.action.trim()) opts.action = this.data.action.trim();
      const r = await ds.adminAuditTrail(opts);
      const list = r.items.map((a) => ({
        ...a,
        actionName: ACTION_NAMES[a.action] || a.action,
        timeText: this.fmtTime(a.createdAt),
      }));
      this.setData({ list, total: r.total, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
