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
  assert(gt.includes('padding: 2px 16px 1px 2px;'), '字母行左右留边回 CK 版（DD批）');
  const row = ct.slice(ct.indexOf('.contact-row {'), ct.indexOf('.contact-row:last-child {'));
  assert(row.includes('padding: 0 16px 0 2px;'), '联系人行左右留边回 CL 版（DD批）');
  assert(row.includes('min-height: 50px;'), '联系人行高度不动');
  assert(gt.includes('border-radius: 8px;'), '字母行圆角回 8px（DD批）');
  assert(gt.includes('background: rgba(253, 239, 203, 0.6);'), '字母行米色（DD批）');
});
