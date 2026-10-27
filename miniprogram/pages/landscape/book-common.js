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
      scrollBox: LC.scrollLayout(LC.SPEC.PAPER_H), // 卷轴贴合定位（AV 分界线锚，_applyOrientation 按实际纸高＋主题重算）
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
    },

    // ---- 内部状态（不进 data） ----
    _machine: null,
    _paperHPx: 0, // 最近一次 _applyOrientation 算出的实际纸高（主题切换时重算卷轴定位用）
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
      const flags = await dataService.getFeatureFlags().catch(() => null);
      const gate = landscapeRoute.resolveLandscapeGate({ membership: m, flags });
      if (gate === 'master-off') {
        wx.showToast({ title: '横置礼单本暂未开放', icon: 'none' });
        wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
        return;
      }
      if (gate === 'member-only') {
        wx.showToast({ title: '横置礼单本是会员专属功能', icon: 'none' });
        wx.redirectTo({ url: '/pages/member/member-home' });
        return;
      }

      const prefs = this._store.getPrefs();
      this.setData({ fontId: prefs.fontId, styleId: prefs.styleId, selStack: LC.selectedStack(prefs.fontId) });
      // 选中才下载：只确保当前所选字体，其余两款等用户在面板里选中再加载
      const ok = await fontManager.ensureSelected(prefs.fontId);
      this.setData({ fontLoaded: ok });

      const permP = this._loadPermissions(); // 权限与内容加载重叠，不再排队
      this._syncOrientation();
      await this.reload();
      await permP;
      // 字体在列渲染后才就绪的机型上，已排版文字可能不自动刷新（任务AB 第 6 项）：
      // 加载成功后用同内容再 setData 一次列模型，强制按新字体重排。
      if (ok) this._convertCols();
      /* BF批（用户要求「不要有延迟」）：本页姓名有 721 子集外字时，
       * 命中的补充片在就绪盖下先加载完再揭盖——打开第一眼缺字就是
       * 枝芒行书，不出现先楷体顶着、过一会儿再换字的跳变。加载失败
       * 不拦开页（回退链照常顶上）。 */
      const suppNames = (this.data.allColumns || []).map((c) => (c.empty ? '' : c.name || '')).join('');
      const suppChunks = LC.suppChunksForText(suppNames);
      if (suppChunks.length && typeof fontManager.ensureSupplements === 'function') {
        await fontManager.ensureSupplements(suppChunks);
        this._convertCols();
      }
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

    /** BD批：每本固定列数（用户定版暂定 15），与纸面定宽配套 */
    _minCols() {
      return LC.SPEC.BOOK_COLS;
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
      // 卷轴贴合（AV 分界线锚）：纸面实际高 = 窗口高 − 上下留白（frame 纵向三段定高＋midrow 弹性），
      // 取不到窗口高时回退基准纸高；分界线对齐纸面、帽子探出、杆缘贴纸缘全在 scrollLayout 里，
      // 锚点逐主题不同，须带当前主题 id；主题随后变化时由 _syncScrollBox 按存下的纸高重算。
      const winH = info && info.windowHeight;
      const paperHPx = (winH && winH > spec.marginV + spec.marginB)
        ? winH - spec.marginV - spec.marginB : spec.paperH;
      this._paperHPx = paperHPx;
      const scrollBox = LC.scrollLayout(paperHPx, this.data.theme && this.data.theme.id);
      this.setData({ spec, safePadL: padL, safePadR: padR, styleRightPx, scrollBox });
      this._syncTileView();
      this._convertCols();
    },

    /** 主题变化后按新主题的分界线锚点重算卷轴定位（AV 批：锚点逐主题不同，
     *  如白事纹带线 34/802 与其余五杆环带线 41/795；纸高沿用 _applyOrientation 存下的实际值） */
    _syncScrollBox() {
      this.setData({
        scrollBox: LC.scrollLayout(this._paperHPx || LC.SPEC.PAPER_H, this.data.theme && this.data.theme.id),
      });
    },

    /** 瓦片显示尺寸 = 瓦片原始尺寸 × 当前 scale（WXML 里不能做乘法，JS 先算好） */
    _syncTileView() {
      const t = this.data.theme;
      const s = this.data.spec.scale;
      if (!t || !t.marginTile) return;
      /* BD批书体定宽：纸面恰好容纳 BOOK_COLS 列＋左右两根卷轴槽，
       * midrow 按此宽居中——卷轴两侧内收、离屏幕边缘留出留白纹。 */
      const slotW = (this.data.scrollBox && this.data.scrollBox.slotW) || this.data.spec.scrollW || 0;
      const bookW = Math.round(LC.SPEC.BOOK_COLS * this.data.spec.colW + 2 * slotW);
      this.setData({
        view: {
          marginTileW: Math.round(t.marginTile.w * s), marginTileH: Math.round(t.marginTile.h * s),
          paperTileW: Math.round(t.paperTile.w * s), paperTileH: Math.round(t.paperTile.h * s),
          bookW,
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

    /** 联系人姓名表一次取齐（原实现逐条记录查联系人，一本 20 条就是 20 趟串行往返） */
    async _loadContactMap() {
      const list = await dataService.listContactsFor(this._ownerId || undefined).catch(() => []);
      const map = {};
      (list || []).forEach((c) => { map[c._id] = c.name; });
      this._contactMap = map;
    },
    _contactNameOf(contactId) {
      return (this._contactMap && this._contactMap[contactId]) || '';
    },

    async _reloadReceive() {
      const [events] = await Promise.all([
        dataService.listEventsFor(this._ownerId || undefined),
        this._loadContactMap(),
      ]);
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
        const name = this._contactNameOf(r.contactId);
        this._recordsById[r._id] = { ...r, contactName: name };
        rows.push({ id: r._id, name, amountFen: r.amount || 0, tagId: ev.tagId });
      }
      // 整本白事判定（AT批）：标签或标题任一指向白事 → 白事样式＋全列奠仪，
      // 绝不出现贺礼；用户手动选了白事样式时中段词同样跟随为奠仪。
      const themeId = LC.resolveReceiveTheme2({ tagId: ev.tagId, title: ev.name }, this.data.styleId);
      const built = LC.buildColumns(rows, {
        fontId: this.data.fontId,
        midText: LC.resolveBookMidText({ tagId: ev.tagId, title: ev.name, styleId: this.data.styleId }),
        minCols: this._minCols(),
      });
      const tag = dataService.getTagById(ev.tagId) || {};
      this.setData({
        emptyBook: false,
        theme: LC.themeById(themeId),
        titleName: ev.name || '',
        titleDate: ev.date || '',
        titleIcon: dataService.tagIcon(ev.tagId),
        allColumns: built.columns,
      });
      this._syncScrollBox(); // 实际主题可能与所选样式不同（标题判白事），按实际主题锚点重算卷轴
      this._afterBuild(built);
    },

    async _reloadGift() {
      // 同收礼本：横置按记账先后排（创建升序、第一笔最左，任务AA）
      const [rawGifts] = await Promise.all([
        dataService.listGiftsFor(this._ownerId || undefined),
        this._loadContactMap(),
      ]);
      const gifts = LC.orderForBook(rawGifts);
      const rows = [];
      this._recordsById = {};
      for (const g of gifts) {
        const name = this._contactNameOf(g.contactId);
        this._recordsById[g._id] = { ...g, contactName: name };
        rows.push({ id: g._id, name, amountFen: g.amount || 0, tagId: g.tagId });
      }
      // 送礼无整本场合：仅当用户手动选了白事样式时整本中段词覆盖为奠仪（AT批）；
      // 其余样式传 undefined → buildColumns 逐列按记录标签出词（baishi 记录仍是奠仪列，不回退）。
      const built = LC.buildColumns(rows, {
        fontId: this.data.fontId,
        midText: LC.resolveBookMidText({ styleId: this.data.styleId }) === '奠仪' ? '奠仪' : undefined,
        minCols: this._minCols(),
      });
      this.setData({
        emptyBook: gifts.length === 0,
        theme: LC.themeById(this.data.styleId),
        titleName: '送礼礼单',
        titleDate: '',
        titleIcon: '',
        allColumns: built.columns,
      });
      this._syncScrollBox(); // 按（可能新换的）样式主题锚点重算卷轴定位
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
      // 纸面内宽按卷轴槽位（AT-6 槽位＝杆身实绘宽）扣左右两根，未算出时回退旧 SCROLL_W
      const slotW = (this.data.scrollBox && this.data.scrollBox.slotW) || spec.scrollW;
      const paperInnerW = Math.max(0, 844 * spec.scale - slotW * 2);
      this.setData({ paperInnerW, scrollLeft: 0 });
      this._convertCols();
      /* BC批补充字库：本页姓名里有 721 子集外的字时，按字定位只加载
       * 命中的补充片（霞鹜文楷补全 GB2312 6763 字），加载后重排一次
       * 让缺字以补充字体显示，而不是落系统黑体。全程异步、不挡页面。 */
      const names = (this.data.allColumns || []).map((c) => (c.empty ? '' : c.name || '')).join('');
      const chunks = LC.suppChunksForText(names);
      if (chunks.length && typeof fontManager.ensureSupplements === 'function') {
        fontManager.ensureSupplements(chunks).then((ok) => { if (ok) this._convertCols(); });
      }
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

    // 删除改走竖屏操作（2026-10-25 用户定：与查看往来/修改一致，跳竖屏详情页里删，
    // 横屏内不再弹删除确认）：竖屏送礼详情/收礼记录详情均有统一删除弹窗。
    onDetailDelete() {
      const d = this.data.detail;
      if (!d) return;
      this._closeDetail();
      const url = isReceive
        ? `/pages/receive-record-detail/receive-record-detail?id=${d.recordId}`
        : `/pages/gift-detail/gift-detail?id=${d.recordId}`;
      wx.navigateTo({ url });
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
      /* BC批：先把新字体加载好再切换——旧顺序先换 fontId 会让文字先以
       * 回退字体（系统楷/宋）闪一帧、新字体到位后再跳变（真机反馈
       * 「切换有延迟」的主观来源）。加载失败则不切换、只提示。 */
      const ok = await fontManager.ensureSelected(id); // 选中才下载
      if (ok) {
        this._store.setFont(id); // 只写字体字段，样式字段不动
        this.setData({ fontId: id, selStack: LC.selectedStack(id), fontLoaded: true });
      }
      if (!ok) {
        // 2026-10-24：字体真机一直显示不了却无任何提示——失败原因必须露出来，
        // 用户一眼能看到卡在哪一步，也方便截图回传定位
        const f = typeof fontManager.getLastFailure === 'function' ? fontManager.getLastFailure(id) : null;
        const fname = LC.fontById(id).name;
        let content;
        if (f && f.stage === 'temp-url' && /NONEXIST|not exist|不存在|no such/i.test(f.reason || '')) {
          content = `云端找不到「${fname}」的字体文件，仍用现在的字体显示。麻烦把这个提示截图发给我们，马上处理。`;
        } else if (f && f.stage === 'temp-url') {
          content = `向云端取「${fname}」字体链接失败：${f.reason}。仍用现在的字体显示，麻烦截图发给我们排查。`;
        } else if (f && f.stage === 'api-data') {
          content = `「${fname}」字体文件从云端获取失败：${f.reason || '未知原因'}。仍用现在的字体显示，麻烦截图发给我们排查。`;
        } else if (f && f.stage === 'data-url') {
          content = `「${fname}」字体文件下载失败：${f.reason || '未知原因'}。仍用现在的字体显示，麻烦截图发给我们排查。`;
        } else if (f && f.reason) {
          content = `「${fname}」字体文件加载失败：${f.reason}。仍用现在的字体显示，麻烦截图发给我们排查。`;
        } else {
          content = `「${fname}」字体文件加载失败，仍用现在的字体显示。麻烦把这个提示截图发给我们排查。`;
        }
        wx.showModal({ title: '字体没加载上', content, showCancel: false });
        return; // BC批：加载失败不切换、不重排
      }
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
        this.setData({ theme: LC.themeById(LC.resolveReceiveTheme2({ tagId: this._event.tagId, title: this._event.name }, this.data.styleId)) });
      } else {
        this.setData({ theme: LC.themeById(this.data.styleId) });
      }
      this._syncScrollBox(); // 分界线锚点随实际主题变，切样式后同步重算卷轴定位
      this._syncTileView();
      // 中段词跟随整本判定（AT批）：切样式后必须重建列，否则只是换了皮、
      // 列里仍是旧中段字（白事样式下仍印贺礼正是此缺口）。reload 内部走
      // _reloadReceive/_reloadGift 的整本判定重算 midText，失败有自身 toast。
      this.reload();
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
