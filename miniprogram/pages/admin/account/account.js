/**
 * 老板平台 · 账号查询（第3项，客服用）
 * 按脱敏编号片段或注册时间段查用户；只显示编号（脱敏）、注册时间、
 * 会员状态与条数汇总，绝不显示任何账本内容。
 */
const ds = require('../../../services/data-service.js');

const STATE_NAMES = { free: '免费', member: '会员', grace: '缓冲期', expired: '已过期' };

Page({
  data: { frag: '', from: '', to: '', list: [], total: 0, loading: false, searched: false, page: 1, canManage: false },
  onLoad() {
    wx.setNavigationBarTitle({ title: '账号查询' });
    // 用户列表（2026-10-24 用户要求加）：打开即按注册时间倒序列出全部用户，
    // 不必先输入编号；上面的条件是可选的过滤，想查谁点一行复制编号即可
    this.loadPage(1, false);
  },
  onFrag(e) { this.setData({ frag: e.detail.value }); },
  onFrom(e) { this.setData({ from: e.detail.value }); },
  onTo(e) { this.setData({ to: e.detail.value }); },
  fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  async loadPage(pageNum, append) {
    this.setData({ loading: true });
    try {
      const opts = { page: pageNum, pageSize: 50 };
      if (this.data.frag.trim()) opts.maskedId = this.data.frag.trim();
      if (this.data.from) opts.from = new Date(`${this.data.from}T00:00:00`).getTime();
      if (this.data.to) opts.to = new Date(`${this.data.to}T23:59:59`).getTime();
      const r = await ds.adminSearchAccounts(opts);
      const items = r.items.map((u) => ({
        ...u,
        stateName: STATE_NAMES[u.memberState] || u.memberState,
        createdText: this.fmtTime(u.createdAt),
      }));
      this.setData({
        list: append ? [...this.data.list, ...items] : items,
        total: r.total, loading: false, searched: true, page: pageNum,
        canManage: !!r.viewerCanManage,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
  async onSearch() { await this.loadPage(1, false); },
  async onLoadMore() {
    if (this.data.loading || this.data.list.length >= this.data.total) return;
    await this.loadPage(this.data.page + 1, true);
  },
  /** 设为管理员（按钮只对云端管理员显示；服务端校验分档，后加管理员不能再加人） */
  onMakeAdmin(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '设为管理员',
      content: `把 ${id} 设为管理员吗？对方能使用老板平台（看统计、改配置），但不能增减管理员；记账数据仍然看不到。`,
      confirmText: '设为管理员',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await ds.adminAddAdmin(id);
          wx.showToast({ title: '已设为管理员', icon: 'none' });
          await this.loadPage(this.data.page, false);
        } catch (err) {
          wx.showToast({ title: ds.friendly(err), icon: 'none' });
        }
      },
    });
  },
  /** 点一行复制脱敏编号：去「额度用量」「账号处理」等页粘贴查询，免手打脱敏号 */
  onCopyId(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '编号已复制', icon: 'none' }),
    });
  },
});
