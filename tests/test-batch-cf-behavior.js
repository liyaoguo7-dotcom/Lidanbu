/** CF批（用户 2026-10-29 定）：我的页礼友栏与会员有效对换颜色——礼友栏
 * 改会员有效黄 #FDEFCB，会员有效改首页家庭共享蓝 #E2EEFB；会员卡片渐变、
 * 我的积分绿、横置行往下纯白不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CF 我的页礼友栏与会员有效对换颜色', () => {
  const mine = readMp('pages/mine/mine.wxss');
  assert(mine.includes('.card.profile { background: #FDEFCB; }'), '礼友栏会员有效黄');
  assert(mine.includes('.m-badge {') && mine.includes('background: #E2EEFB; color: #333;'), '会员有效家庭共享蓝');
  assert(!mine.includes('.card.profile { background: #D0E2F6; }'), '礼友栏不再是深一档蓝');
  assert(mine.includes('linear-gradient(135deg, #F78C8F, #FFC7C3)'), '会员卡渐变不动');
  assert(mine.includes('.m-btn.ghost {') && mine.includes('background: #E0F3E4; color: #333;'), '我的积分绿不动');
  assert(mine.includes('.form-row.rowbg { background: #FFFFFF; }'), '横置行往下纯白不动');
});
