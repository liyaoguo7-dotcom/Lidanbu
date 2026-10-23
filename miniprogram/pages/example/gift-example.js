/**
 * 礼单簿 · 送礼示例页（"点击查看示例"）
 * 用假数据（与本地演示种子同口径）渲染成和真实送礼列表页一样的版式，全只读：
 * 列表 → 点开看详情样式。页面不连任何真实数据。
 * 截图占位说明：本页为真实页面（非截图），docs/screens 记录仍保留占位说明，
 * 等开发者工具里补拍正式截图后替换。
 */
const { tagIconPath } = require('../../config/tag-icons.js');
const { formatAmount, formatAmountInt } = require('../../core/format.js');

/** 示例送礼记录（假数据，金额单位分，一律整档，含一条白事，与演示种子口径一致） */
const GIFTS = [
  { name: '李四', tagId: 'jiehun', tagName: '结婚', amount: 100000, date: '2026-09-18', remark: '' },
  { name: '王五', tagId: 'baishi', tagName: '白事', amount: 50000, date: '2026-09-02', remark: '' },
  { name: '赵六', tagId: 'qiaoqian', tagName: '乔迁', amount: 100000, date: '2026-08-16', remark: '新居快乐' },
  { name: '欧阳修远', tagId: 'shengxue', tagName: '升学', amount: 50000, date: '2026-08-01', remark: '' },
  { name: '陈八', tagId: 'shengri', tagName: '生日', amount: 50000, date: '2026-07-11', remark: '' },
  { name: '周十', tagId: 'dashou', tagName: '大寿', amount: 200000, date: '2026-05-20', remark: '' },
  { name: '郑文杰', tagId: 'shengzi', tagName: '生子', amount: 100000, date: '2026-03-08', remark: '' },
  { name: '孙九', tagId: 'jiehun', tagName: '结婚', amount: 200000, date: '2025-12-25', remark: '' },
];

Page({
  data: {
    view: 'list', // list | detail
    gifts: GIFTS.map((g) => ({
      ...g,
      icon: tagIconPath(g.tagId),
      isBaishi: g.tagId === 'baishi',
      amountText: formatAmount(g.amount),
    })),
    totalCount: GIFTS.length,
    totalText: `￥${formatAmountInt(GIFTS.reduce((s, g) => s + g.amount, 0))} 元`,
    totalAmountText: formatAmountInt(GIFTS.reduce((s, g) => s + g.amount, 0)),
    gift: null,
  },

  openGift(e) {
    const g = this.data.gifts[e.currentTarget.dataset.i];
    if (!g) return;
    this.setData({ view: 'detail', gift: { ...g, remarkText: g.remark || '无' } });
    wx.setNavigationBarTitle({ title: '送礼详情（示例）' });
  },

  backToList() {
    this.setData({ view: 'list', gift: null });
    wx.setNavigationBarTitle({ title: '送礼示例' });
  },
});
