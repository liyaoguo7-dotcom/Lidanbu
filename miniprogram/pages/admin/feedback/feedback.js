/**
 * 老板平台 · 用户反馈列表（第6项）
 * 反馈正文是用户主动提交给平台的文字，可显示；提交人一律脱敏。
 * 可按状态筛选、点开看详情、标记已处理/改回待处理（操作写审计）。
 */
const ds = require('../../services/data-service.js');

Page({
  data: {
    filters: [
      { id: '', name: '全部' },
      { id: 'pending', name: '待处理' },
      { id: 'handled', name: '已处理' },
    ],
    filter: '',
    list: [],
    total: 0,
    loading: false,
    selected: null,
  },
  onLoad() { wx.setNavigationBarTitle({ title: '用户反馈' }); },
  onShow() { this.load(); },
  fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  onFilter(e) { this.setData({ filter: e.currentTarget.dataset.id, selected: null }); this.load(); },
  async load() {
    this.setData({ loading: true });
    try {
      const opts = { page: 1, pageSize: 50 };
      if (this.data.filter) opts.status = this.data.filter;
      const r = await ds.adminFeedbackList(opts);
      const list = r.items.map((f) => ({ ...f, timeText: this.fmtTime(f.createdAt) }));
      this.setData({ list, total: r.total, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
  onSelect(e) {
    const f = this.data.list.find((x) => x._id === e.currentTarget.dataset.id);
    this.setData({ selected: f || null });
  },
  async onToggleStatus() {
    const f = this.data.selected;
    if (!f) return;
    const next = f.status === 'handled' ? 'pending' : 'handled';
    try {
      await ds.adminFeedbackSetStatus(f._id, next);
      wx.showToast({ title: next === 'handled' ? '已标记为已处理' : '已改回待处理', icon: 'none' });
      this.setData({ selected: null });
      this.load();
    } catch (e) {
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
