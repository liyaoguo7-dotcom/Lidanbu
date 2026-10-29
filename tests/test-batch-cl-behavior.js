/** CL批（用户 2026-10-29 定）：亲友录联系人整体向左移、左边只留 2px
 * （字母行与联系人行左内边距 16px 改 2px），右边给 A-Z 字母索引行腾
 * 位置；索引行本身、字母行颜色圆角高度、联系人行其他样式不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CL 亲友录联系人整体左移、左边只留 2px', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  const gt = ct.slice(ct.indexOf('.group-title {'), ct.indexOf('.contact-row {'));
  assert(gt.includes('padding: 2px 0 1px 0;'), '字母行左右内边距归零（CY批通铺）');
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0;'), '联系人行左右内边距归零（CY批通铺）');
  assert(row.includes('min-height: 50px;'), '联系人行高度不动');
  assert(gt.includes('border-radius: 0;'), '字母行通铺改直角');
  assert(gt.includes('background: #666666;'), '字母行暗灰（CY批）');
});
