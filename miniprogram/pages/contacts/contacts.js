/**
 * 礼单簿 · 亲友录（阶段2 2A）
 * 拼音分组；搜索框 + 取消；点姓名弹出半屏（往来记录/修改姓名/删除姓名）；
 * 删除姓名二次确认，写明"将同时删除 X 条收礼、Y 条送礼记录，删除后无法恢复"。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');

// 分组口径在 services/pinyin-initial.js（300+ 姓氏含复姓，2026-10-24 改准）
const { pinyinInitial, compareGroupKey } = require('../../services/pinyin-initial.js');
const { tabSwipeHandlers } = require('../../services/tab-swipe.js');

Page({
  ...tabSwipeHandlers, // CO批：左右滑动切换 tab
  data: {
    hornOff: false, hornRun: false, hornDur: 0, // 小喇叭：关闭（本次打开期间）/长文字慢速左滚（任务AB）
    groups: [],
    presentMap: {},
    hasHashGroup: false,
    indexLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), // 右侧字母快选（全部字母，没人的置灰）
    activeLetter: '',
    bubbleLetter: '',
    bubbleShow: false,
    keyword: '',
    tipText: '小技巧：点击姓名可查询来往记录哦～',
    sheetOpen: false,
    sheetName: '',
    sheetId: '',
    delModal: false,
    delContent: '',
    addSheetOpen: false,
    editSheetOpen: false,
    editName: '',
    editRemark: '',
  },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText, { fontPx: 14, avail: 284 }); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('contacts'); this.setData({ hornOff: true }); },

  async onLoad() {
    this.setData({ hornOff: hornState.isDismissed('contacts') }); this._syncHorn();
    await dataService.init();
  },

  async onShow() {
    this.setData({ swipeX: 0, swipeAnim: false }); // DA批：回 tab 时清掉上次滑动的位移
    await this.reload();
  },

  async reload() {
    const seq = (this._reloadSeq = (this._reloadSeq || 0) + 1);
    const kw = (this.data.keyword || '').trim();
    const list = kw
      ? await dataService.searchContacts(kw)
      : await dataService.listContacts();
    if (seq !== this._reloadSeq) return; // 已有更新的查询，丢弃过期结果
    const by = {};
    list.forEach((c) => {
      const k = pinyinInitial(c.name);
      (by[k] = by[k] || []).push(c);
    });
    const groups = Object.keys(by).sort(compareGroupKey).map((k) => ({ key: k, items: by[k] }));
    this._presentKeys = groups.map((g) => g.key);
    const presentMap = {};
    this._presentKeys.forEach((k) => { presentMap[k] = true; });
    this._barLetters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    if (presentMap['#']) this._barLetters.push('#');
    this._barRect = null; // 栏内容可能变，旧量测作废
    this.setData({
      groups,
      presentMap,
      hasHashGroup: !!presentMap['#'],
    }, () => this._measureGroups());
  },

  /** 量测各分组标题的文档位置（滚动高亮当前字母用） */
  _measureGroups() {
    if (!wx.createSelectorQuery) return; // 极老基础库无此接口时仅失去滚动高亮，快选跳转不受影响
    wx.createSelectorQuery()
      .selectAll('.group-title')
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res) => {
        const rects = (res && res[0]) || [];
        const off = (res && res[1] && res[1].scrollTop) || 0;
        this._groupTops = rects.map((r, i) => ({
          key: (this._presentKeys || [])[i],
          top: r.top + off,
        })).filter((g) => g.key);
      });
  },

  onPageScroll(e) {
    if (!this._groupTops || !this._groupTops.length) return;
    const st = (e && e.scrollTop) || 0;
    let cur = this._groupTops[0].key;
    for (const g of this._groupTops) {
      if (g.top <= st + 140) cur = g.key; else break;
    }
    if (cur !== this.data.activeLetter) this.setData({ activeLetter: cur });
    // 手动滚动时与字母栏点击的短暂锁定互不干扰：点击跳转会置 _jumpLock 直到滚动停稳
  },

  /** 字母栏：点按/滑动选字母 → 跳到对应分组（没人的字母置灰不响应） */
  onIndexTouch(e) {
    const letters = this._barLetters || [];
    if (!letters.length) return;
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!touch) return;
    const go = (rect) => {
      const h = rect.height / letters.length;
      let idx = Math.floor((touch.clientY - rect.top) / h);
      idx = Math.max(0, Math.min(letters.length - 1, idx));
      const letter = letters[idx];
      if (!letter || letter === this._lastIndexLetter) return;
      this._lastIndexLetter = letter;
      if (!(this._presentKeys || []).includes(letter)) {
        this.setData({ bubbleLetter: letter, bubbleShow: true });
        return; // 置灰字母只给气泡反馈，不跳转
      }
      this.setData({ bubbleLetter: letter, bubbleShow: true, activeLetter: letter });
      wx.pageScrollTo({ selector: letter === '#' ? '#anchor-hash' : `#anchor-${letter}`, duration: 0, offsetTop: -10 });
    };
    if (this._barRect) { go(this._barRect); return; }
    if (!wx.createSelectorQuery) return;
    wx.createSelectorQuery().select('.index-bar').boundingClientRect((rect) => {
      this._barRect = rect;
      if (rect) go(rect);
    }).exec();
  },

  onIndexTouchEnd() {
    this._lastIndexLetter = '';
    if (this.data.bubbleShow) this.setData({ bubbleShow: false });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    // 防抖：连续打字只查最后一次（原实现每敲一键一趟云端，结果还会乱序）
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.reload(), 250);
  },

  onCancelSearch() {
    this.setData({ keyword: '' });
    this.reload();
  },

  openSheet(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ sheetOpen: true, sheetId: id, sheetName: name });
  },

  closeSheet() {
    this.setData({ sheetOpen: false });
  },

  goWanglai() {
    const id = this.data.sheetId;
    this.closeSheet();
    if (id) {
      wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${id}` });
    }
  },

  goEdit() {
    const id = this.data.sheetId;
    this.setData({ sheetOpen: false });
    // 取出当前姓名/备注，回填到半屏
    dataService.listContacts().then((list) => {
      const c = list.find((x) => x._id === id) || {};
      this.setData({
        editName: c.name || this.data.sheetName,
        editRemark: c.remark || '',
        editSheetOpen: true,
      });
    }).catch(() => {
      this.setData({ editName: this.data.sheetName, editRemark: '', editSheetOpen: true });
    });
  },

  onEditCancel() {
    this.setData({ editSheetOpen: false });
  },

  async onEditConfirm(e) {
    if (this._saving) return; // 在途锁（任务AE补修：全量排查漏锁时补上，防连点重复提交）
    this._saving = true;
    const { name, remark } = e.detail;
    try {
      await dataService.updateContact(this.data.sheetId, { name, remark });
      this.setData({ editSheetOpen: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.reload();
    } catch (err) {
      wx.showModal({ title: '提示', content: err.message, showCancel: false });
    } finally { this._saving = false; }
  },

  async onDelete() {
    // 第一步：先查影响条数
    try {
      const info = await dataService.deleteContact(this.data.sheetId, false);
      const rc = info.receiveCount || 0;
      const gc = info.giftCount || 0;
      this.setData({
        sheetOpen: false,
        delModal: true,
        delContent: `${this.data.sheetName}\n将同时删除 ${rc} 条收礼、${gc} 条送礼记录`,
      });
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },

  onCancelDel() {
    this.setData({ delModal: false, delContent: '' });
  },

  async onConfirmDel() {
    if (this._deleting) return; // 在途锁（任务AE补修）
    this._deleting = true;
    try {
      await dataService.deleteContact(this.data.sheetId, true);
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.reload();
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this._deleting = false;
      this.setData({ delModal: false, delContent: '' });
    }
  },

  goAdd() {
    this.setData({ addSheetOpen: true });
  },

  onAddCancel() {
    this.setData({ addSheetOpen: false });
  },

  async onAddConfirm(e) {
    if (this._saving) return; // 在途锁（任务AE补修：本页曾漏锁，真机连点 8~9 秒建出十几条重复亲友）
    this._saving = true;
    const { name, remark } = e.detail;
    try {
      const r = await dataService.createContact({ name, remark });
      this.setData({ addSheetOpen: false });
      this.reload(); // 缓存已写穿，列表即时刷新，不再等云端重拉
      if (r && r.duplicateWarning) {
        // core：重名只提醒不阻止，记录已创建
        wx.showModal({
          title: '已保存',
          content: '重名提醒：亲友录中已有同名亲友（不会合并）。',
          showCancel: false,
        });
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.showModal({ title: '提示', content: err.message, showCancel: false });
    } finally { this._saving = false; }
  },
});
