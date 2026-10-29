/** CY批（用户 2026-10-29 定）：CV 的收短一半是错的——恢复通长（去
 * margin-right），米色改暗灰 #666666、字母改白色；亲友录通铺（卡片与行
 * 左右边距归零、圆角改直角）；提示条＋搜索框置顶固定（sticky 包层，
 * 不改两者本身的内外边距；搜索框与提示条不贴边）；A-Z 索引原位浮在上面。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CY 亲友录恢复通长＋暗灰字母条＋通铺＋提示搜索置顶固定', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  const wxml = readMp('pages/contacts/contacts.wxml');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(!gt.includes('margin-right'), 'CV 收短一半已撤销：字母行恢复通长');
  assert(gt.includes('padding: 2px 0 1px 0;'), '字母行左右内边距归零、上下 2px/1px 不动');
  assert(gt.includes('border-radius: 0;'), '字母行通铺改直角');
  assert(gt.includes('color: #fff;'), '字母改白色（暗灰底可读）');
  assert(gt.includes('background: #666666;'), '字母条底色暗灰');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: #666666; }`), `字母行 c${i} 暗灰`);
  const card = ct.slice(ct.indexOf('.card {'), ct.indexOf('.group-title {'));
  assert(card.includes('margin: 10px 0;'), '卡片左右边距归零、上下 10px 不动');
  assert(card.includes('border-radius: 0;'), '卡片通铺改直角');
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0;'), '联系人行左右内边距归零');
  assert(row.includes('min-height: 50px;'), '联系人行高度不动');
  assert(wxml.includes('<view class="fixed-head">'), '提示条＋搜索框包 sticky 置顶层');
  assert(ct.includes('.fixed-head { position: sticky; top: 0; z-index: 10; background: #F6F6F6; }'), '置顶层 sticky top 0、底色同页面底');
  assert(!ct.includes('.searchbar {') && !ct.includes('.tip {'), '搜索框与提示条本身不改（不贴边）');
  assert(ct.includes('.index-bar {') && ct.includes('right: 4px;'), 'A-Z 索引原位不动');
});
