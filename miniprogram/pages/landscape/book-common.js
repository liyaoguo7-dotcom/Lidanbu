/**
 * 礼单簿 · 横置礼单本共用页面逻辑（收礼/送礼只做一份，v3.1「同一组件多处入口只做一份」）
 *
 * receive.js / gift.js 各自 Page(createBookPage('receive' | 'gift'))。
 * 版式/主题/权限/状态机全部走 landscape-core.js 的定版常量与纯函数；
 * 数据只经 services/data-service.js；字体经 services/font-manager.js。
 *
 * 待真机联调（见 docs/wireframes/landscape/横置实现方式说明.md）：
 * - receive/gift 两页 pageOrientation 为 "auto"，靠手机自动旋转感应横竖屏
 *   （2026-10-22 曾改为 "landscape" 强制横屏＋底部「返回竖屏」按钮，同日用户确认
 *   其手机自动旋转正常、不需要，已全部回退为自动感应＋定版原样）；
 * - 转屏淡入是否闪白；刘海屏 safeArea 与胶囊按钮避让；
 * - wx.loadFontFace 本地包路径在真机上的可用性（上线换云存储地址，见 font-manager）。
 */
const dataService = require('../../services/data-service.js');
const fontManager = require('../../services/font-manager.js');
const landscapeRoute = require('../../services/landscape-route.js');
const LC = require('./landscape-core.js');
const { formatAmount } = require('../../core/format.js');

const wxStorage = {
  get(k) { try { return wx.getStorageSync(k); } catch (e) { return ''; } },
  set(k, v) { try { wx.setStorageSync(k, v); } catch (e) { /* 忽略 */ } },
};

function createBookPage(kind) {
  const isReceive = kind === 'receive';
  return {
    data: {
      ready: false,
      isLandscape: false,
      rotateCopy: LC.ROTATE_COPY,
      credit: LC.SPEC.FONT_CREDIT,
      spec: LC.scaledSpec(844),
      theme: LC.THEMES.classic,
      fontId: 'lxgw',
      styleId: 'classic',
      selStack: LC.selectedStack('lxgw'),
      songtiStack: LC.SONGTI_STACK,
      fontLoaded: false,
      titleName: '', titleDate: '', titleIcon: '',
      allColumns: [], cols: [], scrollLeft: 0, paperInnerW: 0,
      styleRightPx: 120, // 「样式」按钮右偏移（避让微信胶囊，_applyOrientation 按胶囊实测位置刷新；任务Z 再左移 10px：110→120）
      selectedKey: '',
      detailOpen: false, detail: null,
      panelOpen: false,
      view: { marginTileW: 28, marginTileH: 28, paperTileW: 28, paperTileH: 28 },
      fonts: LC.FONTS.map((f) => ({ ...f, stack: LC.selectedStack(f.id) })),
      themeList: LC.THEME_LIST,
      perms: { canAdd: true, canEdit: true, canDelete: true },
      emptyBook: false,
      safePadL: 0, safePadR: 0,
      showDelModal: false, delContent: '', delTitle: '删除记录',
    },

    // ---- 内部状态（不进 data） ----
    _machine: null,
    _store: null,
    _ownerId: '',
    _eventId: '',
    _recordsById: {},

    noop() {},

    async onLoad(options) {
      this._machine = LC.createOrientationMachine();
      this._store = LC.createSelectionStore(wxStorage);
      this._ownerId = options.ownerId || '';
      this._eventId = options.eventId || '';
      await dataService.init();

      // 入口门禁：横置礼单本是会员专属，非会员跳会员介绍页
      const m = await dataService.getMembership();
      if (m.state !== 'member' && m.state !== 'grace') {
        wx.showToast({ title: '横置礼单本是会员专属功能', icon: 'none' });
        wx.redirectTo({ url: '/pages/member/member-home' });
        return;
      }

      const prefs = this._store.getPrefs();
      this.setData({ fontId: prefs.fontId, styleId: prefs.styleId, selStack: LC.selectedStack(prefs.fontId) });
      // 选中才下载：只确保当前所选字体，其余两款等用户在面板里选中再加载
      const ok = await fontManager.ensureSelected(prefs.fontId);
      this.setData({ fontLoaded: ok });

      await this._loadPermissions();
      this._syncOrientation();
      await this.reload();
      // 字体在列渲染后才就绪的机型上，已排版文字可能不自动刷新（任务AB 第 6 项）：
      // 加载成功后用同内容再 setData 一次列模型，强制按新字体重排。
      if (ok) this._convertCols();
      this.setData({ ready: true });
    },

    async onShow() {
      if (!this.data.ready) return;
      // 字体加载曾失败时在回页时重试一次（任务Z 第 7 项）：成功后重排一次让新字体立即生效
      if (!this.data.fontLoaded) {
        const okFont = await fontManager.ensureSelected(this.data.fontId);
        if (okFont) { this.setData({ fontLoaded: true }); this._convertCols(); }
      }
      // 返回本页时窗口方向可能已经变了（如去竖屏添加页期间手机一直竖置）：
      // 后台页收不到 onResize，必须在 onShow 用当前窗口尺寸重同步方向，
      // 否则 isLandscape/spec 是旧值，礼单会被竖着渲染（2026-10-22 真机问题根因）。
      this._syncOrientation();
      await this.reload(); // 从新增/修改页返回后刷新
    },

    onResize(res) {
      const size = (res && res.size) || {};
      const w = size.windowWidth || 0;
      const h = size.windowHeight || 0;
      if (!w || !h || !this._machine) return;
      this._handleResize(w, h);
    },

    /** 用当前窗口尺寸重同步方向（onLoad/onShow 调用，与 onResize 共用一条路径） */
    _syncOrientation() {
      let info = null;
      try { info = wx.getWindowInfo(); } catch (e) { /* 忽略 */ }
      if (!info || !this._machine) return;
      const w = info.windowWidth || 0;
      const h = info.windowHeight || 0;
      if (w && h) this._handleResize(w, h);
    },

    _handleResize(w, h) {
      const wasLandscape = this.data.isLandscape;
      const r = this._machine.resize(w, h);
      const flipped = wasLandscape !== r.isLandscape;
      const patch = { isLandscape: r.isLandscape };
      // 只有真的翻转才关半屏详情/面板（状态机翻转时已先关，这里同步到视图）
      if (flipped) { patch.detailOpen = false; patch.panelOpen = false; patch.selectedKey = ''; }
      this.setData(patch);
      this._applyOrientation(w);
    },

    _applyOrientation(winW) {
      let w = winW;
      let info = null;
      try { info = wx.getWindowInfo(); } catch (e) { /* 忽略 */ }
      if (!w && info) w = info.windowWidth;
      if (!w) return;
      const spec = LC.scaledSpec(w);
      let padL = 0, padR = 0;
      if (info && info.safeArea) {
        padL = Math.max(0, info.safeArea.left || 0);
        padR = Math.max(0, w - (info.safeArea.right || w));
      }
      // 「样式」按钮避让微信胶囊：优先按胶囊实测左缘定位（按钮右缘距胶囊左缘 ≥12px），
      // 取不到时保留 data 里的固定兜底偏移（按主流机型胶囊宽度留足）
      let styleRightPx = this.data.styleRightPx;
      try {
        const mb = wx.getMenuButtonBoundingClientRect();
        if (mb && mb.left) styleRightPx = (w - mb.left) + 22; // 胶囊左缘外 12px 避让 + 任务Z 再左移 10px
      } catch (e) { /* 忽略，用兜底值 */ }
      this.setData({ spec, safePadL: padL, safePadR: padR, styleRightPx });
      this._syncTileView();
      this._convertCols();
    },

    /** 瓦片显示尺寸 = 瓦片原始尺寸 × 当前 scale（WXML 里不能做乘法，JS 先算好） */
    _syncTileView() {
      const t = this.data.theme;
      const s = this.data.spec.scale;
      if (!t || !t.marginTile) return;
      this.setData({
        view: {
          marginTileW: Math.round(t.marginTile.w * s), marginTileH: Math.round(t.marginTile.h * s),
          paperTileW: Math.round(t.paperTile.w * s), paperTileH: Math.round(t.paperTile.h * s),
        },
      });
    },

    async _loadPermissions() {
      if (!this._ownerId || this._ownerId === dataService.userId) {
        this.setData({ perms: LC.permissionsFor({ isOwner: true }) });
        return;
      }
      const grant = await dataService.getGrantFor(this._ownerId);
      this.setData({ perms: LC.permissionsFor({ isOwner: false, switches: grant ? grant.switches : {} }) });
    },

    async reload() {
      try {
        if (isReceive) await this._reloadReceive();
        else await this._reloadGift();
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
      }
    },

    async _reloadReceive() {
      const events = await dataService.listEventsFor(this._ownerId || undefined);
      if (!events.length) {
        const built = LC.buildColumns([], { fontId: this.data.fontId });
        this.setData({ emptyBook: true, allColumns: built.columns, titleName: '收礼礼簿' });
        this._afterBuild(built);
        return;
      }
      const ev = events.find((e) => e._id === this._eventId) || events[0];
      this._eventId = ev._id;
      this._event = ev;
      // 横置按记账先后排（创建升序、第一笔最左）：列表接口是最新在前，须翻正（任务AA）
      const recs = LC.orderForBook(await dataService.listRecordsFor(this._ownerId || undefined, ev._id));
      const rows = [];
      this._recordsById = {};
      for (const r of recs) {
        const c = await dataService.getContact(r.contactId, this._ownerId || undefined);
        const name = c ? c.name : '';
        this._recordsById[r._id] = { ...r, contactName: name };
        rows.push({ id: r._id, name, amountFen: r.amount || 0, tagId: ev.tagId });
      }
      const themeId = LC.resolveReceiveTheme(ev.tagId, this.data.styleId);
      const built = LC.buildColumns(rows, { fontId: this.data.fontId, midText: LC.midTextForTag(ev.tagId) });
      const tag = dataService.getTagById(ev.tagId) || {};
      this.setData({
        emptyBook: false,
        theme: LC.themeById(themeId),
        titleName: ev.name || '',
        titleDate: ev.date || '',
        titleIcon: dataService.tagIcon(ev.tagId),
        allColumns: built.columns,
      });
      this._afterBuild(built);
    },

    async _reloadGift() {
      // 同收礼本：横置按记账先后排（创建升序、第一笔最左，任务AA）
      const gifts = LC.orderForBook(await dataService.listGiftsFor(this._ownerId || undefined));
      const rows = [];
      this._recordsById = {};
      for (const g of gifts) {
        const c = await dataService.getContact(g.contactId, this._ownerId || undefined);
        const name = c ? c.name : '';
        this._recordsById[g._id] = { ...g, contactName: name };
        rows.push({ id: g._id, name, amountFen: g.amount || 0, tagId: g.tagId });
      }
      const built = LC.buildColumns(rows, { fontId: this.data.fontId });
      this.setData({
        emptyBook: gifts.length === 0,
        theme: LC.themeById(this.data.styleId),
        titleName: '送礼礼单',
        titleDate: '',
        titleIcon: '',
        allColumns: built.columns,
      });
      this._afterBuild(built);
    },

    /**
     * 构建后定位到最左（第一条记录）并全量渲染。
     * 【竞态根因记录】旧实现是窗口化渲染：按 scrollLeft 只渲染可视 ±2 列，
     * 且初始 scrollLeft 被设到最右端（旧口径 records[0] 在最右）。scroll-view
     * 初始布局时 scroll 事件的时序不确定，窗口随每次打开的时序漂移——真机
     * 表现为同一本子多次打开少几列、从中间开始。现改为全量确定性渲染：
     * 所有列一次渲染完、scrollLeft 恒为 0，渲染内容与滚动位置彻底解耦。
     */
    _afterBuild() {
      this._syncTileView();
      const spec = this.data.spec;
      const paperInnerW = Math.max(0, 844 * spec.scale - spec.scrollW * 2);
      this.setData({ paperInnerW, scrollLeft: 0 });
      this._convertCols();
    },

    /** 全量列渲染模型：基准 px × scale 换算成实际 px（字号已在 buildColumns 封顶中段字号，任务AB 第 1 项） */
    _convertCols() {
      const spec = this.data.spec;
      const s = spec.scale;
      const midSelPx = LC.round2(LC.renderFontSize(LC.SPEC.MID_FONT, this.data.fontId) * s);
      const midSongPx = LC.round2(LC.SPEC.MID_FONT * s);
      const cols = this.data.allColumns.map((c) => {
        if (c.empty) return c;
        return {
          ...c,
          nameFontPx: LC.round2(c.nameFontSize * s),
          amountFontPx: LC.round2(c.amountFontSize * s),
          midFontPx: c.midRole === 'selected' ? midSelPx : midSongPx,
          nameChars: c.nameChars.map((ch) => ({ ch: ch.ch, topPx: LC.round2(ch.top * s) })),
          midChars: c.midChars.map((ch) => ({ ch: ch.ch, topPx: LC.round2(ch.top * s) })),
          amountChars: c.amountChars.map((ch) => ({ ch: ch.ch, topPx: LC.round2(ch.top * s) })),
        };
      });
      this.setData({ cols });
    },

    // ---- 点列 / 半屏详情 ----
    onColTap(e) {
      const key = e.currentTarget.dataset.key;
      const col = this.data.allColumns.find((c) => c.key === key);
      if (!col || col.empty) { this._closeDetail(); return; }
      const r = this._recordsById[col.recordId];
      if (!r) return;
      this._machine.openDetail();
      const occasion = isReceive
        ? (this._event ? this._event.name : '')
        : ((dataService.getTagById(r.tagId) || {}).name || '');
      this.setData({
        selectedKey: key,
        detailOpen: true,
        detail: {
          recordId: r._id,
          contactId: r.contactId,
          name: r.contactName || col.name,
          date: r.date || '',
          amountText: formatAmount(r.amount || 0),
          remark: r.remark || '',
          occasion,
          midText: col.midText,
        },
      });
    },

    _closeDetail() {
      if (this._machine) this._machine.closeDetail();
      this.setData({ detailOpen: false, selectedKey: '', detail: null });
    },

    onCloseDetail() { this._closeDetail(); },

    onDetailTimeline() {
      const d = this.data.detail;
      if (!d) return;
      const owner = this._ownerId ? `&ownerId=${this._ownerId}` : '';
      wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${d.contactId}${owner}` });
    },

    onDetailEdit() {
      const d = this.data.detail;
      if (!d) return;
      this._closeDetail();
      const url = isReceive
        ? `/pages/receive-record-edit/receive-record-edit?id=${d.recordId}`
        : `/pages/gift-edit/gift-edit?id=${d.recordId}`;
      wx.navigateTo({ url });
    },

    onDetailDelete() {
      const d = this.data.detail;
      if (!d) return;
      this.setData({
        showDelModal: true,
        delTitle: '删除记录',
        delContent: `${d.occasion} · ${d.name}\n日期 ${d.date || '-'} · 金额 ¥${d.amountText}`,
      });
    },

    onCancelDel() { this.setData({ showDelModal: false }); },

    async onConfirmDel() {
      const d = this.data.detail;
      this.setData({ showDelModal: false });
      if (!d) return;
      try {
        if (isReceive) await dataService.deleteRecord(d.recordId);
        else await dataService.deleteGift(d.recordId);
        wx.showToast({ title: '已删除', icon: 'success' });
        this._closeDetail();
        await this.reload();
      } catch (err) {
        wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
      }
    },

    // ---- 样式面板（字体/样式两组独立、互不重置、立即生效） ----
    onOpenPanel() {
      if (this._machine) this._machine.openPanel();
      this.setData({ panelOpen: true });
    },
    onClosePanel() {
      if (this._machine) this._machine.closePanel();
      this.setData({ panelOpen: false });
    },

    async onPickFont(e) {
      const id = e.currentTarget.dataset.id;
      if (id === this.data.fontId) return;
      this._store.setFont(id); // 只写字体字段，样式字段不动
      this.setData({ fontId: id, selStack: LC.selectedStack(id) });
      const ok = await fontManager.ensureSelected(id); // 选中才下载
      this.setData({ fontLoaded: ok });
      await this.reload(); // 字号校准系数变了，重排列模型
    },

    onPickStyle(e) {
      const id = e.currentTarget.dataset.id;
      if (id === this.data.styleId) { this._refreshTheme(); return; }
      this._store.setStyle(id); // 只写样式字段，字体字段不动
      this.setData({ styleId: id });
      this._refreshTheme();
    },

    _refreshTheme() {
      if (isReceive && this._event) {
        this.setData({ theme: LC.themeById(LC.resolveReceiveTheme(this._event.tagId, this.data.styleId)) });
      } else {
        this.setData({ theme: LC.themeById(this.data.styleId) });
      }
      this._syncTileView();
    },

    // ---- 新增 / 导航 ----
    onAdd() {
      const url = isReceive
        ? `/pages/receive-record-add/receive-record-add?eventId=${this._eventId}`
        : '/pages/gift-add/gift-add';
      wx.navigateTo({ url });
    },

    goBack() {
      wx.navigateBack({
        delta: 1,
        fail: () => this.goPortrait(),
      });
    },

    /** 「切换回竖置样式」（定版图30）：回普通竖置礼单（不丢数据、不影响会员状态）；
     *  同时把横置开关写回关闭，避免下次点礼薄又被开关自动带回横置（mine 开关 onShow 时同步） */
    goPortrait() {
      landscapeRoute.writeLandscapeOn(false, wxStorage);
      if (isReceive && this._eventId) {
        wx.redirectTo({ url: `/pages/receive-detail/receive-detail?id=${this._eventId}` });
      } else if (isReceive) {
        wx.redirectTo({ url: '/pages/receive/receive' });
      } else {
        wx.redirectTo({ url: '/pages/gifts/gifts' });
      }
    },
  };
}

module.exports = { createBookPage };
