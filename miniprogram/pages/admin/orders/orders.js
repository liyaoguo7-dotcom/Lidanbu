/**
 * 老板平台 · 会员订单与收入（第7项）
 * 订单金额是平台订单数据（不是用户账本里的礼金），可列出：
 * 脱敏用户、档位名、金额、状态、时间，以及收入汇总（按档位/状态聚合）。
 */
const ds = require('../../services/data-service.js');
const { formatAmount } = require('../../../core/format.js');

const STATUS_NAMES = { pending: '待支付', paid: '已支付', failed: '支付失败', cancelled: '已取消', refunded: '已退款' };

Page({
  data: {
    filters: [
      { id: '', name: '全部' },
      { id: 'paid', name: '已支付' },
      { id: 'pending', name: '待支付' },
      { id: 'refunded', name: '已退款' },
      { id: 'cancelled', name: '已取消' },
      { id: 'failed', name: '失败' },
    ],
    filter: '',
    stats: null,
    list: [],
    total: 0,
    loading: false,
  },
  onLoad() { wx.setNavigationBarTitle({ title: '会员订单与收入' }); },
  onShow() { this.load(); },
  fmtFen(fen) { return `¥${formatAmount(fen || 0)}`; },
  fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  onFilter(e) { this.setData({ filter: e.currentTarget.dataset.id }); this.load(); },
  async load() {
    this.setData({ loading: true });
    try {
      const [stats, r] = await Promise.all([
        ds.adminOrderStats(),
        ds.adminOrderList({ page: 1, pageSize: 50, status: this.data.filter || undefined }),
      ]);
      const view = {
        ...stats,
        paidText: this.fmtFen(stats.paidRevenueFen),
        refundedText: this.fmtFen(stats.refundedFen),
        byPlan: stats.byPlan.map((p) => ({ ...p, revenueText: this.fmtFen(p.revenueFen) })),
      };
      const list = r.items.map((o) => ({
        ...o,
        amountText: this.fmtFen(o.amountFen),
        statusName: STATUS_NAMES[o.status] || o.status,
        timeText: this.fmtTime(o.createdAt),
      }));
      this.setData({ stats: view, list, total: r.total, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
