/** CV批（用户 2026-10-29 定）：亲友录整体再左移、左边只留 0.5px；
 * 淡黄色字母条再透明一点（0.6→0.4）；黄条长度收短二分之一（左边不动、
 * 右边收）。右边 16px、搜索框、索引行、圆角、上下内边距都不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CV 亲友录左移 0.5px＋黄条更透明＋收短一半', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(gt.includes('padding: 2px 16px 1px 0.5px;'), '字母行左内边距 0.5px、右 16px 不动、上下 2px/1px 不动');
  assert(gt.includes('margin-right: 50%;'), '黄条长度收短二分之一（左边不动、右边收）');
  assert(gt.includes('border-radius: 8px;'), '黄条圆角不动');
  assert(!ct.includes('rgba(253, 239, 203, 0.6)'), '旧透明度 0.6 不得残留');
  assert(ct.includes('background: rgba(253, 239, 203, 0.4);'), '黄条更透明 0.4');
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0 16px 0 0.5px;'), '联系人行左内边距 0.5px、右 16px 不动');
  assert(row.includes('min-height: 50px;'), '联系人行高度不动');
});
