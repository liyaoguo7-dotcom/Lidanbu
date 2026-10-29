/** DD批（用户 2026-10-29 定）：亲友录暗灰字母条太难看，颜色圆角边距一起回 CK 版：
 * 字母条回淡黄半透明米色、字母回深灰、圆角回 8px、字母行与联系人行左右留边、
 * 卡片回全局边距圆角；通长、上下 2px/1px、字号 12px、行高 50px、置顶层、索引位置不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DD 亲友录字母条回米色＋圆角＋留边', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  const wxml = readMp('pages/contacts/contacts.wxml');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(!gt.includes('margin-right'), '字母行恢复通长不动');
  assert(gt.includes('padding: 2px 16px 1px 2px;'), '字母行左右留边、上下 2px/1px');
  assert(gt.includes('border-radius: 8px;'), '字母行圆角 8px');
  assert(gt.includes('color: #666;'), '字母回深灰');
  assert(gt.includes('background: rgba(253, 239, 203, 0.6);'), '字母条底色淡黄半透明米色');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: rgba(253, 239, 203, 0.6); }`), `字母行 c${i} 米色`);
  assert(ct.includes('.card { overflow: hidden; }'), '卡片回全局边距圆角（通铺撤销）');
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0 16px 0 2px;'), '联系人行左右留边');
  assert(row.includes('min-height: 50px;'), '联系人行高度不动');
  assert(wxml.includes('<view class="fixed-head">'), '提示条＋搜索框置顶层不动');
  assert(ct.includes('.fixed-head { position: sticky; top: 0; z-index: 10; background: #F6F6F6; }'), '置顶层不动');
  assert(ct.includes('.index-bar {') && ct.includes('right: 4px;'), 'A-Z 索引原位不动');
});
