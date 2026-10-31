/** DG批（用户 2026-10-30 定）：
 * 我的页头像栏改识别（拍照导入 import-home）收礼方块色（橙黄渐变）；
 * 会员卡片改识别送礼方块色（红色渐变）；本页所有行右边箭头统一 16→18px；
 * 栏内头像／名字／会员字、卡内文字、会员有效（#E2EEFB）与我的积分（#E0F3E4）颜色都不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DG 我的页：头像栏识别收礼橙黄＋会员卡识别送礼红＋全页箭头18px', () => {
  const mine = readMp('pages/mine/mine.wxss');
  const wxml = readMp('pages/mine/mine.wxml');
  const home = readMp('pages/import/import-home.wxss');
  // 2026-10-31 用户定：DG 两渐变作废，头像栏改首页收礼左边 #FFE4B8 半透明淡黄、会员卡改首页送礼右边 #F78C8F，均为纯色不渐变
  assert(mine.includes('.card.profile { background: rgba(255, 228, 184, 0.6); }'), '头像栏收礼左边半透明淡黄纯色（2026-10-31，取代 DG 渐变）');
  assert(mine.includes('background: #F78C8F;'), '会员卡片送礼右边浓粉红纯色（2026-10-31，取代 DG 渐变）');
  assert(home.includes('.kind-card.receive { background: linear-gradient(135deg, #FFB84D, #FF9F2E); }'), '头像栏色与识别收礼方块同值');
  assert(home.includes('.kind-card.gift { background: linear-gradient(135deg, #F67070, #F0575A); }'), '会员卡色与识别送礼方块同值');
  assert(mine.includes('.chev { font-size: 18px; }'), '本页所有行右边箭头统一 18px（头像栏＋下面各行一致）');
  assert(mine.includes('.m-badge {') && mine.includes('background: #E2EEFB; color: #333;'), '会员有效淡蓝不动');
  assert(mine.includes('.m-btn.ghost {') && mine.includes('background: #E0F3E4; color: #333;'), '我的积分淡绿不动');
  assert(wxml.includes('class="card profile"') && wxml.includes('class="uname"') && wxml.includes('class="usub"'), '头像栏结构不动（头像／名字／会员字）');
  assert(wxml.includes('class="card member-card"') && wxml.includes('class="m-title"') && wxml.includes('class="m-desc"'), '会员卡结构不动（标题／有效期／积分余额）');
  assert(!mine.includes('.card.profile { background: #FDEFCB; }'), '旧头像栏淡黄不得残留');
  assert(!mine.includes('linear-gradient(135deg, #F78C8F, #FFC7C3)'), '旧会员卡送礼粉红不得残留');
});
