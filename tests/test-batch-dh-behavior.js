/** DH批（用户 2026-10-30 定）：
 * 横置提示页（独立提示页与书页竖屏态共用）左上角箭头改与系统箭头一致：
 * 字号 60rpx→44rpx（约 22px），顶栏顶垫状态栏高度（env(safe-area-inset-top)），
 * 箭头落到状态栏下方、不再贴屏幕角；可点区仍 88rpx。
 * 书页必须保留自定义导航（横置书页自绘顶栏），故不用系统导航栏、只改共用箭头样式。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DH 提示页箭头：与系统箭头一致（44rpx＋状态栏顶垫＋88rpx可点区）', () => {
  const wxss = readMp('pages/landscape/book.wxss');
  const back = (wxss.match(/\.rotate-back \{[^}]*\}/) || [''])[0];
  assert(back.includes('font-size: 44rpx'), '箭头字号 44rpx（约 22px，贴近系统箭头）');
  assert(back.includes('width: 88rpx') && back.includes('height: 88rpx'), '可点区仍 88rpx（≥44px）');
  const top = (wxss.match(/\.rotate-topbar \{[^}]*\}/) || [''])[0];
  assert(top.includes('env(safe-area-inset-top)'), '顶栏顶垫状态栏高度，箭头不再贴屏幕角');
  assert(top.includes('height: calc(88rpx + env(safe-area-inset-top))'), '顶栏高=内容 88rpx＋状态栏');
  assert(readMp('pages/landscape/rotate/rotate.wxml').includes('class="rotate-back"'), '独立提示页共用此箭头样式');
  assert(readMp('pages/landscape/book.wxml').includes('class="rotate-back"'), '书页竖屏态共用此箭头样式，两处一致');
  for (const p of ['pages/landscape/gift/gift.json', 'pages/landscape/receive/receive.json']) {
    assert(JSON.parse(readMp(p)).navigationStyle === 'custom', `${p} 仍自定义导航（横置书页自绘顶栏，不能用系统栏）`);
  }
});
