/**
 * 老板平台 · 账号查询（第3项，客服用）
 * 按脱敏编号片段或注册时间段查用户；只显示编号（脱敏）、注册时间、
 * 会员状态与条数汇总，绝不显示任何账本内容。
 */
const ds = require('../../../services/data-service.js');

const STATE_NAMES = { free: '免费', member: '会员', grace: '缓冲期', expired: '已过期' };

Page({
  data: { frag: '', from: '', to: '', list: [], total: 0, loading: false, searched: false },
  onLoad() { wx.setNavigationBarTitle({ title: '账号查询' }); },
  onFrag(e) { this.setData({ frag: e.detail.value }); },
  onFrom(e) { this.setData({ from: e.detail.value }); },
  onTo(e) { this.setData({ to: e.detail.value }); },
  fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  async onSearch() {
    this.setData({ loading: true });
    try {
      const opts = { page: 1, pageSize: 50 };
      if (this.data.frag.trim()) opts.maskedId = this.data.frag.trim();
      if (this.data.from) opts.from = new Date(`${this.data.from}T00:00:00`).getTime();
      if (this.data.to) opts.to = new Date(`${this.data.to}T23:59:59`).getTime();
      const r = await ds.adminSearchAccounts(opts);
      const list = r.items.map((u) => ({
        ...u,
        stateName: STATE_NAMES[u.memberState] || u.memberState,
        createdText: this.fmtTime(u.createdAt),
      }));
      this.setData({ list, total: r.total, loading: false, searched: true });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
