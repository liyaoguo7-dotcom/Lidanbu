/**
 * 礼单簿 · 收礼示例页（"点击查看示例"）
 * 用假数据（与本地演示种子同口径）渲染成和真实收礼页一样的版式，全只读：
 * 礼薄列表 → 点开看记录列表 → 点记录看详情样式。页面不连任何真实数据。
 * 截图占位说明：本页为真实页面（非截图），docs/screens 记录仍保留占位说明，
 * 等开发者工具里补拍正式截图后替换。
 */
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount } = require('../../core/format.js');

/** 示例礼薄与记录（假数据，金额单位分，一律整档，与演示种子口径一致） */
const BOOKS = [
  {
    _id: 'ex-book-1', name: '张三的婚礼', tagId: 'jiehun', tagName: '结婚', date: '2026-10-01',
    records: [
      { name: '张三', amount: 100000, type: '现金', date: '2026-10-01', remark: '' },
      { name: '李四', amount: 50000, type: '微信', date: '2026-10-01', remark: '' },
      { name: '王五', amount: 50000, type: '红包', date: '2026-10-01', remark: '' },
      { name: '赵六', amount: 200000, type: '转账', date: '2026-10-01', remark: '' },
      { name: '刘七', amount: 100000, type: '现金', date: '2026-10-01', remark: '' },
      { name: '陈八', amount: 300000, type: '微信', date: '2026-10-01', remark: '' },
      { name: '孙九', amount: 100000, type: '支付宝', date: '2026-10-01', remark: '' },
      { name: '周十', amount: 1000000, type: '转账', date: '2026-10-01', remark: '老同学' },
      { name: '吴小明', amount: 50000, type: '红包', date: '2026-10-01', remark: '' },
      { name: '郑文杰', amount: 400000, type: '现金', date: '2026-10-01', remark: '' },
      { name: '欧阳修远', amount: 100000, type: '微信', date: '2026-10-01', remark: '' },
      { name: '欧阳', amount: 200000, type: '现金', date: '2026-10-01', remark: '' },
    ],
  },
  {
    _id: 'ex-book-2', name: '赵六的乔迁宴', tagId: 'qiaoqian', tagName: '乔迁', date: '2026-08-16',
    records: [
      { name: '张三', amount: 100000, type: '微信', date: '2026-08-16', remark: '' },
      { name: '李四', amount: 50000, type: '红包', date: '2026-08-16', remark: '' },
      { name: '王五', amount: 100000, type: '现金', date: '2026-08-16', remark: '' },
      { name: '刘七', amount: 200000, type: '转账', date: '2026-08-16', remark: '新居快乐' },
      { name: '陈八', amount: 50000, type: '微信', date: '2026-08-16', remark: '' },
    ],
  },
  {
    _id: 'ex-book-3', name: '王老太爷丧礼', tagId: 'baishi', tagName: '白事', date: '2026-06-20',
    records: [
      { name: '张三', amount: 50000, type: '现金', date: '2026-06-20', remark: '' },
      { name: '李四', amount: 50000, type: '现金', date: '2026-06-20', remark: '' },
      { name: '王五', amount: 100000, type: '现金', date: '2026-06-20', remark: '' },
      { name: '赵六', amount: 100000, type: '现金', date: '2026-06-20', remark: '' },
    ],
  },
];

function decorateBook(b) {
  const total = b.records.reduce((s, r) => s + r.amount, 0);
  return {
    ...b,
    icon: tagIconPath(b.tagId),
    isBaishi: b.tagId === 'baishi',
    count: b.records.length,
    amtText: formatAmount(total),
  };
}

Page({
  data: {
    view: 'list', // list | records | detail
    books: BOOKS.map(decorateBook),
    book: null,
    records: [],
    record: null,
  },

  openBook(e) {
    const b = this.data.books.find((x) => x._id === e.currentTarget.dataset.id);
    if (!b) return;
    this.setData({
      view: 'records',
      book: b,
      records: b.records.map((r) => ({ ...r, amountText: formatAmount(r.amount) })),
    });
    wx.setNavigationBarTitle({ title: b.name });
  },

  openRecord(e) {
    const r = this.data.records[e.currentTarget.dataset.i];
    if (!r) return;
    this.setData({ view: 'detail', record: { ...r, remarkText: r.remark || '无' } });
    wx.setNavigationBarTitle({ title: '收礼详情（示例）' });
  },

  backToRecords() {
    this.setData({ view: 'records', record: null });
    wx.setNavigationBarTitle({ title: this.data.book.name });
  },

  backToList() {
    this.setData({ view: 'list', book: null, records: [], record: null });
    wx.setNavigationBarTitle({ title: '收礼示例' });
  },
});
