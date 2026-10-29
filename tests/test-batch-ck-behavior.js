/** CK批（用户 2026-10-29 定）＋CK修正（用户同日纠正：是上下太宽不是
 * 左右宽）：亲友录字母行浅蓝改淡黄再透明一点（rgba 0.6）；上下收窄
 * （内边距 6px/2px 改 2px/1px）；左右长度不动，全部换圆角。
 * 联系人行、绑定、卡裁溢出不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CK 亲友录字母行透明淡黄＋上下收窄＋全圆角', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: #666666; }`), `字母行 c${i} 暗灰（CY批：米色改暗灰）`);
  assert(!ct.includes('#E2EEFB'), '字母行不再有浅蓝');
  assert(!ct.includes('#FDEFCB'), '字母行不再是实色淡黄');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(gt.includes('padding: 2px 0 1px 0;'), '字母行上下内边距收窄、左右归零（CY批通铺）');
  assert(!gt.includes('margin-right'), 'CV批收短一半已作废：字母行恢复通长');
  assert(gt.includes('border-radius: 0;'), '字母行通铺改直角');
  assert(readMp('pages/contacts/contacts.wxml').includes('group-title c{{gi % 6}}'), '字母行绑定不动');
  assert(ct.includes('.card { overflow: hidden; margin: 10px 0; border-radius: 0; }'), '亲友录卡裁溢出不动、通铺（CY批）');
});
