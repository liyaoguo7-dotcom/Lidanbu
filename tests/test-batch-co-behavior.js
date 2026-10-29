/** CO批（用户 2026-10-29 定）：四个 tab 页左右滑动切换 tab。
 * 左滑 → 下一个 tab，右滑 → 上一个 tab，到头不循环；只认横向主导
 * 的滑动（≥60px 且横向 ≥ 纵向×1.5），竖向滚动、点按、字母索引竖拖
 * 不触发；首页与往来绑在原有单根上，亲友录与我的页包一层无样式层。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');
const { TAB_SWIPE_TABS, tabSwipeNext } = require('../miniprogram/services/tab-swipe.js');

test('CO 滑动切 tab：方向、阈值、到头', () => {
  assert.eq(TAB_SWIPE_TABS.join(','), '/pages/index/index,/pages/wanglai/wanglai,/pages/contacts/contacts,/pages/mine/mine', 'tab 顺序与底栏一致');
  assert.eq(tabSwipeNext('pages/index/index', -80, 10), '/pages/wanglai/wanglai', '首页左滑 → 往来');
  assert.eq(tabSwipeNext('pages/wanglai/wanglai', 80, 10), '/pages/index/index', '往来右滑 → 首页');
  assert.eq(tabSwipeNext('pages/contacts/contacts', -80, 0), '/pages/mine/mine', '亲友录左滑 → 我的');
  assert.eq(tabSwipeNext('pages/mine/mine', 80, 0), '/pages/contacts/contacts', '我的右滑 → 亲友录');
  assert.eq(tabSwipeNext('pages/index/index', 80, 0), null, '首页右滑到头不动');
  assert.eq(tabSwipeNext('pages/mine/mine', -80, 0), null, '我的左滑到头不动');
  assert.eq(tabSwipeNext('pages/index/index', -40, 0), null, '滑动不足 60px 不触发');
  assert.eq(tabSwipeNext('pages/index/index', -80, 100), null, '竖向主导不触发');
  assert.eq(tabSwipeNext('pages/index/index', 0, 0), null, '点按不触发');
  assert.eq(tabSwipeNext('pages/landscape/gift/gift', -80, 0), null, '非 tab 页不触发');
});

test('CO 四页接线：共用逻辑＋手势绑定', () => {
  for (const p of ['pages/index/index', 'pages/wanglai/wanglai', 'pages/contacts/contacts', 'pages/mine/mine']) {
    const js = readMp(p + '.js');
    assert(js.includes("require('../../services/tab-swipe.js')"), `${p} 引用共用逻辑`);
    assert(js.includes('...tabSwipeHandlers,'), `${p} 混入滑动处理`);
    const wxml = readMp(p + '.wxml');
    assert(wxml.includes('bindtouchstart="onTabSwipeStart"') && wxml.includes('bindtouchend="onTabSwipeEnd"'), `${p} 绑定手势`);
  }
  const wl = readMp('pages/wanglai/wanglai.wxml');
  assert(wl.includes('<scroll-view class="wl-scroll" scroll-y>'), '往来列表仍是竖向滚动（不受横滑干扰）');
});
