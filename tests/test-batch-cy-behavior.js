/** CY批（用户 2026-10-29 定）：CV 的收短一半是错的——恢复通长（去
 * margin-right）；提示条＋搜索框置顶固定（sticky 包层，不改两者本身的
 * 内外边距；搜索框与提示条不贴边）；A-Z 索引原位浮在上面。
 * DD批（用户同日定）：CY 的暗灰字母条＋通铺已撤销，颜色圆角边距回 CK 版，见 DD 测试。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CY 亲友录恢复通长＋提示搜索置顶固定（DD批：暗灰字母条＋通铺已撤销）', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  const wxml = readMp('pages/contacts/contacts.wxml');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(!gt.includes('margin-right'), 'CV 收短一半已撤销：字母行恢复通长');
  assert(gt.includes('padding: 2px 16px 1px 2px;'), '字母行左右留边回 CK 版、上下 2px/1px 不动（DD批）');
  assert(gt.includes('border-radius: 8px;'), '字母行圆角回 8px（DD批）');
  assert(gt.includes('color: #666;'), '字母回深灰（DD批）');
  assert(gt.includes('background: rgba(253, 239, 203, 0.6);'), '字母条底色回米色（DD批）');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: rgba(253, 239, 203, 0.6); }`), `字母行 c${i} 米色（DD批）`);
  const card = ct.slice(ct.indexOf('.card {'), ct.indexOf('.group-title {'));
  assert(!card.includes('margin: 10px 0;'), '卡片通铺撤销（DD批）');
  assert(!card.includes('border-radius: 0;'), '卡片直角撤销（DD批）');
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0 16px 0 2px;'), '联系人行左右留边回 CL 版（DD批）');
  assert(row.includes('min-height: 50px;'), '联系人行高度不动');
  assert(wxml.includes('<view class="fixed-head">'), '提示条＋搜索框包 sticky 置顶层');
  assert(ct.includes('.fixed-head { position: sticky; top: 0; z-index: 10; background: #F6F6F6; }'), '置顶层 sticky top 0、底色同页面底');
  assert(!ct.includes('.searchbar {') && !ct.includes('.tip {'), '搜索框与提示条本身不改（不贴边）');
  assert(ct.includes('.index-bar {') && ct.includes('right: 4px;'), 'A-Z 索引原位不动');
});
