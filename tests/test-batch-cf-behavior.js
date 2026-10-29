/** CF批（用户 2026-10-29 定）：我的页礼友栏与会员有效对换颜色——礼友栏
 * 改会员有效黄 #FDEFCB，会员有效改首页家庭共享蓝 #E2EEFB；会员卡片渐变、
 * 我的积分绿、横置行往下纯白不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CF 我的页礼友栏与会员有效对换颜色', () => {
  const mine = readMp('pages/mine/mine.wxss');
  assert(mine.includes('.card.profile { background: linear-gradient(135deg, #FFB84D, #FF9F2E); }'), '头像栏改识别收礼橙黄渐变（DG批）');
  assert(mine.includes('.m-badge {') && mine.includes('background: #E2EEFB; color: #333;'), '会员有效家庭共享蓝');
  assert(!mine.includes('.card.profile { background: #D0E2F6; }'), '礼友栏不再是深一档蓝');
  assert(mine.includes('linear-gradient(135deg, #F67070, #F0575A)'), '会员卡改识别送礼红渐变（DG批）');
  assert(mine.includes('.m-btn.ghost {') && mine.includes('background: #E0F3E4; color: #333;'), '我的积分绿不动');
  assert(mine.includes('.form-row.rowbg { background: #FFFFFF; }'), '横置行往下纯白不动');
});
