/**
 * 老板平台 · 管理员账号、权限与操作记录（第10项）
 * 管理员名单只读展示（名单维护走云数据库 appConfig 文档直写，现行口径）；
 * 操作记录 = AuditLog 查询，可按动作类型过滤，操作者一律脱敏。
 */
const ds = require('../../../services/data-service.js');

const ACTION_NAMES = {
  config: '修改配置', grant: '开通会员', payment: '支付', refund: '退款',
  feedback: '处理反馈', restrict: '限制用户', unrestrict: '解除限制',
  create: '新增', update: '修改', delete: '删除', share: '家庭共享', export: '导出',
};

Page({
  data: { admins: [], action: '', list: [], total: 0, loading: false },
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
      this.setData({ admins: r.admins });
    } catch (e) {
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
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
