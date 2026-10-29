/**
 * 礼单簿 · 往来页（v3.1 第五章版）
 * 自上而下：标题「人情往来」→ 时间标签 → 时间跨度 → 搜索框 →
 *   左右对照（收礼/送礼：上总额、下笔数）→ 合计 → 差额区（淡黄底红字，绝对值无符号）
 *   → 亲友列表（姓名、笔数、金额，点进竖线树）。
 * 调 data-service.getWanglaiList（经 core.stats.contactStats/memberStats）。
 * ?ownerId=xxx 时为成员视角：顶部淡字"仅统计已授权给你的记录"。
 */
const dataService = require('../../services/data-service.js');
const { formatAmountInt } = require('../../core/format.js');
const { tabSwipeHandlers } = require('../../services/tab-swipe.js');

const RANGES = [
  { id: 'all', name: '全部' },
  { id: 'today', name: '今日' },
  { id: 'month', name: '本月' },
  { id: 'year', name: '今年' },
  { id: 'lastYear', name: '近一年' },
  { id: 'custom', name: '自定义▾' },
];

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** YYYY-MM-DD → 2026.10.16 */
function dotDate(s) {
  return String(s || '').replace(/-/g, '.');
}

Page({
  ...tabSwipeHandlers, // CO批：左右滑动切换 tab
  data: {
    ranges: RANGES,
    rangeId: 'lastYear',
    customFrom: '',
    customTo: '',
    rangeText: '',
    keyword: '',
    searching: false,
    searchResults: [],
    rows: [],
    isMember: false,
    receiveTotalText: '0.00',
    receiveCountText: '0笔',
    giftTotalText: '0.00',
    giftCountText: '0笔',
    totalText: '',
    diffText: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.ownerId = options.ownerId || '';
    const t = today();
    this.setData({ customFrom: t, customTo: t });
    await this.reload();
  },

  async onShow() {
    this.setData({ swipeX: 0, swipeAnim: false }); // DA批：回 tab 时清掉上次滑动的位移
    await this.reload();
  },

  rangeParam() {
    if (this.data.rangeId === 'custom') {
      return { start: this.data.customFrom, end: this.data.customTo };
    }
    return this.data.rangeId;
  },

  async reload() {
    const kw = (this.data.keyword || '').trim();
    try {
      if (kw) {
        // 搜索模式：输入姓名出联系人
        const list = await dataService.searchWanglaiContacts({ ownerId: this.ownerId || undefined, keyword: kw });
        this.setData({
          searching: true,
          searchResults: list.map((c) => ({ contactId: c._id, name: c.name, remark: c.remark || '' })),
        });
        return;
      }
      const r = await dataService.getWanglaiList({
        ownerId: this.ownerId || undefined,
        range: this.rangeParam(),
      });
      const rows = r.rows.map((x) => ({
        ...x,
        countText: `${x.count}笔`,
        // 往来页金额一律整数（用户 2026-10-18 拍板）；方向靠 +/- 号表达
        diffText: `${x.diffFen < 0 ? '-' : '+'}${formatAmountInt(Math.abs(x.diffFen))}`,
      }));
      const totalCount = r.totalReceiveCount + r.totalGiftCount;
      this.setData({
        searching: false,
        rows,
        isMember: r.isMember,
        rangeText: this.data.rangeId === 'all' ? '全部时间' : `${dotDate(r.from)} 至 ${dotDate(r.to)}`,
        receiveTotalText: formatAmountInt(r.totalReceiveFen),
        receiveCountText: `${r.totalReceiveCount}笔`,
        giftTotalText: formatAmountInt(r.totalGiftFen),
        giftCountText: `${r.totalGiftCount}笔`,
        totalText: `合计：${totalCount} 笔 · ${rows.length} 位亲友`,
        // 差额只显示金额绝对值：「差额」二字由 wxml 的 diff-label 呈现，js 不再拼前缀（防重复，2026-10-22 真机反馈）
        diffText: `${formatAmountInt(Math.abs(r.diffFen))}`,
      });
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },

  onRangeTap(e) {
    this.setData({ rangeId: e.currentTarget.dataset.id });
    this.reload();
  },

  onCustomFromChange(e) {
    this.setData({ customFrom: e.detail.value, rangeId: 'custom' });
    this.reload();
  },

  onCustomToChange(e) {
    this.setData({ customTo: e.detail.value, rangeId: 'custom' });
    this.reload();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.reload();
  },

  onCancelSearch() {
    this.setData({ keyword: '' });
    this.reload();
  },

  goTimeline(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    const ownerQ = this.ownerId ? `&ownerId=${this.ownerId}` : '';
    const nameQ = name ? `&name=${encodeURIComponent(name)}` : '';
    wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${id}${ownerQ}${nameQ}` });
  },
});
