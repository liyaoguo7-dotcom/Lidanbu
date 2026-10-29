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
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: rgba(253, 239, 203, 0.6); }`), `字母行 c${i} 米色（DD批：暗灰改回）`);
  assert(!ct.includes('#E2EEFB'), '字母行不再有浅蓝');
  assert(!ct.includes('#FDEFCB'), '字母行不再是实色淡黄');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(gt.includes('padding: 2px 16px 1px 2px;'), '字母行上下 2px/1px、左右留边回 CK 版（DD批）');
  assert(!gt.includes('margin-right'), 'CV批收短一半已作废：字母行恢复通长');
  assert(gt.includes('border-radius: 8px;'), '字母行圆角 8px（DD批）');
  assert(readMp('pages/contacts/contacts.wxml').includes('group-title c{{gi % 6}}'), '字母行绑定不动');
  assert(ct.includes('.card { overflow: hidden; }'), '亲友录卡裁溢出不动、通铺撤销（DD批）');
});
