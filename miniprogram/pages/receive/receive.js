/**
 * 礼单簿 · 收礼主页
 * 结构：标题「收礼礼簿」→ 小喇叭提示条（可关闭，状态存本地）→ 淡色共计行 →
 * 列表（图案/名称+日期/共N笔|¥金额/⋯）→ 右滑出现修改/删除 → 底部中间红色＋。
 * 标题/礼薄名称用宋体栈，金额/日期用黑体（系统默认），不引入外部字体。
 * 金额规则（用户 2026-10-18 拍板）：列表行两位小数（formatAmount），
 * 共计行整数（formatAmountInt）；图案一律 tagIconPath。
 */
const dataService = require('../../services/data-service.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount, formatAmountInt } = require('../../core/format.js');

const HORN_KEY = 'receiveHornClosed';
const SWIPE_W = 150; // 修改75 + 删除75

Page({
  data: {
    events: [],
    hasEvents: false,
    totalCount: 0,
    totalText: '0.00',
    showHorn: true,
    showDelModal: false,
    delContent: '',
    delEventId: '',
  },

  touchStartX: 0,

  async onShow() {
    await dataService.init();
    let closed = false;
    try { closed = wx.getStorageSync(HORN_KEY) === '1'; } catch (e) { /* 忽略 */ }
    this.setData({ showHorn: !closed });
    await this.reload();
  },

  async reload() {
    const list = await dataService.listEvents();
    const rows = [];
    let totalFen = 0;
    for (const e of list) {
      const st = await dataService.getEventStats(e._id);
      totalFen += st.totalFen;
      const tag = dataService.getTagById(e.tagId) || {};
      rows.push({
        _id: e._id,
        name: e.name,
        date: e.date || '',
        count: st.count,
        amtText: formatAmountInt(st.totalFen),
        icon: tagIconPath(tag.id),
        isBaishi: e.tagId === 'baishi',
        offset: 0,
      });
    }
    this.setData({
      events: rows,
      hasEvents: rows.length > 0,
      totalCount: rows.length,
      totalText: formatAmountInt(totalFen),
    });
  },

  // ---- 小喇叭 ----
  closeHorn() {
    try { wx.setStorageSync(HORN_KEY, '1'); } catch (e) { /* 忽略 */ }
    this.setData({ showHorn: false });
  },

  // ---- 右滑 ----
  onTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    const id = e.currentTarget.dataset.id;
    const events = this.data.events.map((r) => (r._id === id ? r : { ...r, offset: 0 }));
    this.setData({ events });
  },

  onTouchMove(e) {
    const id = e.currentTarget.dataset.id;
    const dx = e.touches[0].clientX - this.touchStartX;
    const offset = Math.max(-SWIPE_W, Math.min(0, dx));
    const events = this.data.events.map((r) => (r._id === id ? { ...r, offset } : r));
    this.setData({ events });
  },

  onTouchEnd(e) {
    const id = e.currentTarget.dataset.id;
    const events = this.data.events.map((r) => {
      if (r._id !== id) return r;
      return { ...r, offset: r.offset < -SWIPE_W / 2 ? -SWIPE_W : 0 };
    });
    this.setData({ events });
  },

  closeAllSwipes() {
    this.setData({ events: this.data.events.map((r) => ({ ...r, offset: 0 })) });
  },

  // 行点击：有滑开的行先收回，否则进礼薄详情
  onRowTap(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.events.some((r) => r.offset !== 0)) {
      this.closeAllSwipes();
      return;
    }
    wx.navigateTo({ url: `/pages/receive-detail/receive-detail?id=${id}` });
  },

  // ---- ⋯ ----
  onMore(e) {
    const id = e.currentTarget.dataset.id;
    this.closeAllSwipes();
    wx.showActionSheet({
      itemList: ['改名', '删除整个礼薄'],
      success: (res) => {
        if (res.tapIndex === 0) this.goRename(id);
        else if (res.tapIndex === 1) this.askDelete(id);
      },
    });
  },

  onEditSwipe(e) {
    this.goRename(e.currentTarget.dataset.id);
  },

  onDeleteSwipe(e) {
    this.askDelete(e.currentTarget.dataset.id);
  },

  goRename(id) {
    this.closeAllSwipes();
    wx.navigateTo({ url: `/pages/receive-add/receive-add?eventId=${id}` });
  },

  askDelete(id) {
    const row = this.data.events.find((r) => r._id === id);
    if (!row) return;
    this.closeAllSwipes();
    this.setData({
      showDelModal: true,
      delEventId: id,
      delContent: `${row.name} · 共${row.count}条收礼记录\n将同时删除 ${row.count} 条收礼记录`,
    });
  },

  onCancelDel() {
    this.setData({ showDelModal: false, delEventId: '' });
  },

  async onConfirmDel() {
    const id = this.data.delEventId;
    this.setData({ showDelModal: false, delEventId: '' });
    if (!id) return;
    try {
      await dataService.deleteEvent(id);
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.reload();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/receive-add/receive-add' });
  },

  goSample() {
    wx.showToast({ title: '示例页占位', icon: 'none' });
  },
});
