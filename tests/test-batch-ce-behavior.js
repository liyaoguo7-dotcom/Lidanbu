/** CE批（用户 2026-10-29 定）：往来收送两块仍各自独立并排（不是一张卡
 * 内分栏），两块颜色都改今日粉 #FDE8E8（取代 CD 的今年绿）；合计＋差额
 * 合并卡与联系人行纯白不动。CJ批（用户同日定，预览图确认）：中间分隔线
 * 取消，两块彻底独立（容器去卡化、留空隙、各自全圆角），颜色不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CE 往来收送两块并排、都用今日粉', () => {
  const wl = readMp('pages/wanglai/wanglai.wxss');
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  assert(wl.includes('background: #FDE8E8;'), '收送块今日粉');
  assert(!wl.includes('.compare .side:first-child { background: #E0F3E4; }'), '收礼块不再是今年绿');
  assert(!wl.includes('.side + .side { border-left:'), '两块中间分隔线取消（CJ批）');
  const sides = (wxml.match(/<view class="side">/g) || []).length;
  assert.eq(sides, 2, '收送仍为两个各自的方块，不是并进一张卡');
  assert(wl.includes('.tchip.chip-today { background: #FDE8E8; }'), '今日粉色值与上方今日按钮一致');
});
