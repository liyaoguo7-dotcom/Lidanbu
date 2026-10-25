/**
 * 礼单簿 · 收礼主页
 * 结构：标题「收礼礼簿」→ 小喇叭提示条（可关闭，本次打开期间不再显示）→ 淡色共计行 →
 * 列表（图案/名称+日期/共N笔|¥金额/⋯）→ 右滑出现修改/删除 → 底部中间红色＋。
 * 标题/礼薄名称用宋体栈，金额/日期用黑体（系统默认），不引入外部字体。
 * 金额规则（用户 2026-10-18 拍板）：列表行两位小数（formatAmount），
 * 共计行整数（formatAmountInt）；图案一律 tagIconPath。
 */
const dataService = require('../../services/data-service.js');
const landscapeRoute = require('../../services/landscape-route.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount, formatAmountInt } = require('../../core/format.js');

const SWIPE_W = 112; // AH批按视频复刻：修改56 + 删除56（原各75）

Page({
  data: {
    events: [],
    hasEvents: false,
    totalCount: 0,
    totalText: '0.00',
    showHorn: true,
    hornText: '查看收礼记录，从右往左滑动可以修改、删除礼簿~',
    hornRun: false, hornDur: 0, // 小喇叭长文字慢速左滚（任务AB 第 8 项）
    showDelModal: false,
    delContent: '',
    delEventId: '',
  },

  touchStartX: 0,
  _membership: null,
  _membershipP: null,

  async onShow() {
    await dataService.init();
    // 缓存会员状态，供行点击时走横置路由判断（横置页内还会再校验一次门禁）；
    // 与列表加载并发，不再排在列表前面堵住显示
    const membershipP = dataService.getMembership()
      .then((m) => { this._membership = m; })
      .catch(() => { this._membership = null; });
    this._membershipP = membershipP;
    // 小喇叭关闭状态只存内存（horn-state）：本次打开期间不再显示，下次冷启动恢复
    this.setData({ showHorn: !hornState.isDismissed('receive') });
    const hm = hornMarquee(this.data.hornText, { fontPx: 14, avail: 284 }); // AH批：喇叭字 14px、通栏可用宽
    this.setData({ hornRun: hm.run, hornDur: hm.dur });
    await this.reload();
    await membershipP;
  },

  async reload() {
    // 一次取齐（2026-10-24 提速）：原来逐本问统计，本数越多越慢
    const list = await dataService.listEventsWithStats();
    const rows = [];
    let totalFen = 0;
    for (const e of list) {
      totalFen += e.totalFen || 0;
      const tag = dataService.getTagById(e.tagId) || {};
      rows.push({
        _id: e._id,
        ownerId: e.ownerId || '',
        name: e.name,
        date: e.date || '',
        count: e.count || 0,
        amtText: formatAmountInt(e.totalFen || 0),
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
    hornState.dismiss('receive'); // 只记内存，冷启动自动恢复显示（不落 storage）
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

  /** 会员状态确保就绪（2026-10-25 真机修复）：此前行点击直接读缓存的
   * _membership，进页面点得快、或 onShow 那次取会员状态还没回来/失败时，
   * 缓存是 null，会被当成非会员放行竖版——横置跳转时有时无（用户实测）。
   * 现在点击时先等在途的那次取回；仍为空（曾失败）就当场再取一次，
   * 保证路由判断永远基于确认过的状态，不看运气。 */
  async _ensureMembership() {
    if (this._membership) return this._membership;
    if (this._membershipP) { try { await this._membershipP; } catch (e) { /* 已在链上置 null */ } }
    if (this._membership) return this._membership;
    try { this._membership = await dataService.getMembership(); } catch (e) { this._membership = null; }
    return this._membership;
  },

  // 行点击：有滑开的行先收回，否则进礼薄详情
  // 横置开关开 + 会员 → 进横置礼单本；其余情况与原行为一致（竖置详情）
  async onRowTap(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.events.some((r) => r.offset !== 0)) {
      this.closeAllSwipes();
      return;
    }
    const row = this.data.events.find((r) => r._id === id);
    const membership = await this._ensureMembership();
    const flags = await dataService.getFeatureFlags().catch(() => null);
    const route = landscapeRoute.resolveBookRoute({
      landscapeOn: landscapeRoute.readLandscapeOn(),
      membership,
      flags,
    });
    if (route === 'landscape' && row) {
      const owner = row.ownerId ? `&ownerId=${row.ownerId}` : '';
      wx.navigateTo({ url: `/pages/landscape/receive/receive?eventId=${id}${owner}` });
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
    wx.navigateTo({ url: '/pages/example/receive-example' });
  },
});
