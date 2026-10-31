/** CF批（用户 2026-10-29 定）：我的页礼友栏与会员有效对换颜色——礼友栏
 * 改会员有效黄 #FDEFCB，会员有效改首页家庭共享蓝 #E2EEFB；会员卡片渐变、
 * 我的积分绿、横置行往下纯白不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CF 我的页礼友栏与会员有效对换颜色', () => {
  const mine = readMp('pages/mine/mine.wxss');
  // 2026-10-31 用户定：DG 橙黄渐变作废，头像栏改首页收礼左边 #FFE4B8 半透明淡黄纯色不渐变
  assert(mine.includes('.card.profile { background: rgba(255, 228, 184, 0.6); }'), '头像栏收礼左边半透明淡黄纯色（2026-10-31）');
  assert(mine.includes('.m-badge {') && mine.includes('background: #E2EEFB; color: #333;'), '会员有效家庭共享蓝');
  assert(!mine.includes('.card.profile { background: #D0E2F6; }'), '礼友栏不再是深一档蓝');
  // 2026-10-31 用户定：DG 红渐变作废，会员卡改首页送礼右边浓粉红 #F78C8F 纯色不渐变
  assert(mine.includes('background: #F78C8F;'), '会员卡改送礼右边浓粉红纯色（2026-10-31）');
  assert(mine.includes('.m-btn.ghost {') && mine.includes('background: #E0F3E4; color: #333;'), '我的积分绿不动');
  assert(mine.includes('.form-row.rowbg { background: #FFFFFF; }'), '横置行往下纯白不动');
});
