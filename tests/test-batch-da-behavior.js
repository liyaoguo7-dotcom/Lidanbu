/** DA批（用户 2026-10-29 选方案 1）：tab 滑动加推出动画——手指横向拖动
 * 时整页内容跟手平移（left，不用 transform，避免 fixed 子元素定位错乱），
 * 松手够远即 switchTab（新页直接出现、无滑入），不够远弹回原位；到头不
 * 跟手；竖向滚动不触发；各页 onShow 清掉上次滑动的位移。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DA tab 滑动推出动画：跟手平移＋不够远弹回', () => {
  const svc = readMp('services/tab-swipe.js');
  assert(svc.includes('onTabSwipeMove'), '共用服务有 touchmove 跟手处理');
  assert(svc.includes('swipeX') && svc.includes('swipeAnim'), '跟手位移与弹回动画走 swipeX/swipeAnim');
  assert(svc.includes('windowWidth') && svc.includes('Math.max(-w, Math.min(w, dx))'), '跟手位移按屏宽封顶');
  assert(svc.includes('Math.abs(dx) >= Math.abs(dy) * 1.5'), '跟手只认横向主导（竖向滚动不触发）');
  assert(svc.includes('swipeAnim: true'), '松手不够远弹回原位（开过渡）');
  assert(!svc.includes('translateX'), '平移不用 transform（保 fixed 子元素定位）');
  for (const p of ['pages/index/index', 'pages/wanglai/wanglai', 'pages/contacts/contacts', 'pages/mine/mine']) {
    const wxml = readMp(`${p}.wxml`);
    assert(wxml.includes('bindtouchmove="onTabSwipeMove"'), `${p} 绑 touchmove`);
    assert(wxml.includes('left: {{swipeX}}px'), `${p} 根节点跟手平移`);
    assert(wxml.includes("swipeAnim ? 'swipe-back' : ''"), `${p} 弹回过渡类`);
    const js = readMp(`${p}.js`);
    assert(js.includes('swipeX: 0, swipeAnim: false'), `${p} onShow 清滑动位移`);
  }
  assert(readMp('app.wxss').includes('.swipe-back { transition: left .25s ease-out; }'), '弹回过渡 0.25s');
});
