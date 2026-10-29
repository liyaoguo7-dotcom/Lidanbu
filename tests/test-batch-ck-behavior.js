/** CK批（用户 2026-10-29 定，截图确认）：亲友录字母行浅蓝改淡黄
 * #FDEFCB（与本月按钮、会员有效同色）；行带太宽，左右各收 12px、
 * 加 8px 圆角，成 inset 小条。联系人行、绑定、卡裁溢出不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CK 亲友录字母行淡黄＋收窄', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: #FDEFCB; }`), `字母行 c${i} 淡黄`);
  assert(!ct.includes('#E2EEFB'), '字母行不再有浅蓝');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(gt.includes('margin: 8px 12px 0;'), '字母行左右各收 12px');
  assert(gt.includes('border-radius: 8px;'), '字母行加圆角');
  assert(readMp('pages/contacts/contacts.wxml').includes('group-title c{{gi % 6}}'), '字母行绑定不动');
  assert(ct.includes('.card { overflow: hidden; }'), '亲友录卡裁溢出不动');
});
