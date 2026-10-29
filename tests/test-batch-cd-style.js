/** CD批颜色（用户 2026-10-29 定，先记录后动手）：
 * 亲友录字母行六色循环取消、全换浅蓝；我的页礼友栏深一档、横置礼单本
 * 行往下纯白；往来收送同色今年绿、卡片化，合计＋差额合并一卡本月淡黄
 * 且两行靠紧，联系人行纯白。顶部提示条黄、＋号红按钮、底部导航红字、
 * 时间按钮六色、会员卡片渐变、会员有效黄、我的积分绿一律不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CD 颜色：亲友录统一浅蓝、我的页深蓝＋以下纯白', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: #FDEFCB; }`), `字母行 c${i} 淡黄（CK批，取代 CD 浅蓝）`);
  assert(!ct.includes('#FDE8E8') && !ct.includes('#FFC7C3') && !ct.includes('#FFE4B8'), '亲友录不再有粉/橙六色');
  const mine = readMp('pages/mine/mine.wxss');
  assert(mine.includes('.card.profile { background: #FDEFCB; }'), '礼友栏会员有效黄（CF批）');
  assert(mine.includes('.form-row.rowbg { background: #FFFFFF; }'), '横置行往下纯白');
  assert(mine.includes('.contact-btn.rowbg { background: #FFFFFF; }'), '联系客服纯白');
});

test('CD 颜色：往来收送卡片化＋合计差额合并卡靠紧＋联系人行纯白', () => {
  const wl = readMp('pages/wanglai/wanglai.wxss');
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  assert(wl.includes('.compare {') && wl.includes('margin: 6px 12px 0;'), '对照区左右留边（CJ批：容器不再是卡，圆角移到两块各自身上）');
  assert(wl.includes('.summary-card {') && wl.includes('background: #FBF3D9;'), '合并卡本月淡黄');
  assert(wl.includes('.summary-card .total-line { background: transparent; padding: 8px 0 2px; }'), '合计行贴紧（下间距 2px）');
  assert(wl.includes('.summary-card .diff-bar { background: transparent; margin: 0; padding: 2px 16px 8px; }'), '差额行贴紧（上间距 2px）');
  assert(wxml.includes('<view class="summary-card">'), '合计与差额同在一卡');
  assert(wl.includes('.wl-row.rowbg { background: #FFFFFF; }'), '联系人行纯白');
  // 不动项：时间按钮六色、差额红字、会员卡渐变
  assert(wl.includes('.tchip.chip-all { background: #E2EEFB; }'), '时间按钮蓝不动');
  assert(wl.includes('.tchip.chip-lastYear { background: #FFC7C3; }'), '时间按钮送礼粉不动');
  assert(readMp('pages/mine/mine.wxss').includes('linear-gradient(135deg, #F78C8F, #FFC7C3)'), '会员卡渐变不动');
});
