/** DI批（用户 2026-10-30 定）：我的页头像栏“会员”二字加深 #999→#666，其余不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DI 我的页：头像栏“会员”二字加深', () => {
  const wxss = readMp('pages/mine/mine.wxss');
  assert(wxss.includes('.usub { font-size: 16px; color: #666;'), '会员字由 #999 加深到 #666');
  assert(readMp('pages/mine/mine.wxml').includes('class="usub"'), '会员字仍在头像栏名字下方');
});
