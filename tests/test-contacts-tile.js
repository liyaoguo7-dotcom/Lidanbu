/** 2026-10-31 用户定（最后一个，后经用户纠正）：亲友录左右不要留空白、平铺，
 * 但其他的都不动。最终口径只动一项：亲友录卡片左右边距 12px→0（上下 10px 不动），
 * 其余全部回改之前：卡片圆角回全局、字母行内边距回 2px 16px 1px 2px、联系人行
 * 回 0 16px 0 2px、字母黄条仍淡黄半透明米色 rgba(253,239,203,0.6)、字母仍深灰 #666、
 * 圆角仍 8px、上下内边距仍 2px/1px、字号 12px、行高 50px、置顶层与右侧字母索引不动；
 * 提示条与搜索框本身不动；只改亲友录页，不动全局样式。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('2026-10-31 亲友录平铺：只动卡片左右边距，其他都不动', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  const card = ct.slice(ct.indexOf('.card {'), ct.indexOf('.group-title {'));
  assert(card.includes('margin: 10px 0;'), '卡片左右边距归零（上下 10px 不动）');
  assert(!card.includes('border-radius'), '卡片圆角不动（回全局，不在亲友录页改直角）');
  assert(card.includes('overflow: hidden;'), '卡片裁溢出不动');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(gt.includes('padding: 2px 16px 1px 2px;'), '字母行内边距不动');
  assert(gt.includes('border-radius: 8px;'), '字母黄条圆角仍 8px');
  assert(gt.includes('background: rgba(253, 239, 203, 0.6);'), '字母条仍淡黄半透明米色');
  assert(gt.includes('color: #666;'), '字母仍深灰');
  assert(gt.includes('font-size: 12px;'), '字母字号 12px 不动');
  assert(!gt.includes('margin-right'), '字母行仍通长，不收短');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: rgba(253, 239, 203, 0.6); }`), `字母行 c${i} 米色`);
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0 16px 0 2px;'), '联系人行内边距不动');
  assert(row.includes('min-height: 50px;'), '联系人行高度 50px 不动');
  assert(ct.includes('.fixed-head { position: sticky; top: 0; z-index: 10; background: #F6F6F6; }'), '置顶层不动');
  assert(ct.includes('.index-bar {') && ct.includes('right: 4px;'), '右侧字母索引原位不动');
  assert(!ct.includes('.searchbar {') && !ct.includes('.tip {'), '搜索框与提示条本身不动');
});
