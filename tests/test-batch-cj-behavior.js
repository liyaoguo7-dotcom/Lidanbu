/** CJ批（用户 2026-10-29 定，预览图确认）：往来收送两块彻底独立——
 * 容器不再是一张卡（去底色、去圆角、去裁剪），两块之间留 12px 空隙，
 * 各自全圆角，中间分隔线取消；颜色不动：收送仍今日粉 #FDE8E8，
 * 合计卡仍本月淡黄 #FBF3D9。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CJ 往来收送两块彻底独立、中间留空隙', () => {
  const wl = readMp('pages/wanglai/wanglai.wxss');
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  const compare = wl.slice(wl.indexOf('.compare {'), wl.indexOf('.summary-card {'));
  assert(compare.includes('display: flex;'), '对照区仍 flex 并排');
  assert(compare.includes('gap: 12px;'), '两块之间留 12px 空隙');
  assert(!compare.includes('background:'), '容器不再有底色（不是一张卡）');
  assert(!compare.includes('border-radius:'), '容器不再有圆角');
  assert(!compare.includes('overflow:'), '容器不再裁剪');
  assert(!wl.includes('.side + .side'), '分隔线规则已删除');
  const side = wl.slice(wl.indexOf('.side {'), wl.indexOf('.side-label {'));
  assert(side.includes('.side:first-child { background: linear-gradient(135deg, #FFE4B8, #FDBE68); }'), '收礼块底色（CP批：首页收礼渐变）');
  assert(side.includes('.side:last-child { background: linear-gradient(135deg, #FFC7C3, #F78C8F); }'), '送礼块底色（CP批：首页送礼渐变）');
  assert(side.includes('border-radius: 12px;'), '每块各自全圆角');
  const sides = (wxml.match(/<view class="side">/g) || []).length;
  assert.eq(sides, 2, '收送仍为两个方块');
  assert(wl.includes('.summary-card {') && wl.includes('background: #FBF3D9;'), '合计卡仍本月淡黄不动');
});
