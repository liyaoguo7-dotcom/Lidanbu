/** DB批（用户 2026-10-29 定，两处一起改）：联系人弹窗取消按钮改小——
 * 高 44→40px，宽不再通长、贴合文字（左右各留 12px），行里居中，字号
 * 17px、红底白字、行高 58px 不动；往来收送两块笔数字体加深 #999→#666，
 * 字号 13px 不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DB 取消按钮改小＋往来笔数字体加深', () => {
  const ct = readMp('pages/contacts/contacts.wxss');
  assert(ct.includes('.cancel-btn { padding: 0 12px; height: 40px; line-height: 40px;'), '取消按钮高 40px、贴合文字');
  assert(ct.includes('font-size: 17px; color: #fff; background: #F0575A; border-radius: 20px;'), '取消按钮字号红底白字不动、圆角 20px');
  assert(ct.includes('.sopt.cancel { display: flex; align-items: center; justify-content: center;'), '取消行 58px、按钮行里居中');
  const wl = readMp('pages/wanglai/wanglai.wxss');
  assert(wl.includes('.side-count { font-size: 13px; color: #666; margin-top: 4px; }'), '往来笔数字体加深 #666、字号 13px 不动');
});
