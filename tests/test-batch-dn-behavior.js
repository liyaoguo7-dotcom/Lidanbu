/** DN批（用户 2026-10-30 定，DF 名块作废）：收礼主页整行方块改首页收礼
 * 橙黄渐变，名字本身不再作块；日期／共几笔 #666、金额、滑动结构全不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DN 收礼主页：整行方块橙黄渐变＋名字不再作块', () => {
  const wxss = readMp('pages/receive/receive.wxss');
  const wxml = readMp('pages/receive/receive.wxml');
  assert(wxss.includes('.event-row.rowbg { background: linear-gradient(135deg, #FFE4B8, #FDBE68); }'), '整行方块改首页收礼橙黄渐变');
  assert(wxss.includes('.nm { font-size: 16px; font-weight: 600; }'), '礼薄名只留 16px 加粗、无底色无圆角无内边距');
  assert(!wxss.includes('.nm { font-size: 16px; font-weight: 600; background:'), '礼薄名不再带任何背景');
  assert(wxss.includes('.dt { font-size: 12px; color: #666;'), '日期仍 #666');
  assert(wxss.includes('.cnt { color: #666; }'), '共几笔仍 #666');
  assert(wxss.includes('.amt { color: #1A1A1A; font-weight: 700; font-size: 14px; }'), '金额不动');
  assert(wxss.includes('.list {') && wxss.includes('background: #fff;'), '外面大白框不动');
  assert(wxml.includes('class="event-row rowbg"') && wxml.includes('class="swipe-actions"'), '行结构与左右滑动修改／删除不动');
});
