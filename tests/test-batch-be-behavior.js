/**
 * BE批行为测试（2026-10-27 用户真机逐条点名）：
 * ①首页自制白色服务条整体删除——微信右上角自带同款「小程序提供
 *   服务」条且自动收缩，自制件（挂在首页左下方）与之重复；
 * ②「我的」页取消家庭共享入口（功能与首页入口保留，只删此行与其
 *   页面处理函数）；
 * ③我的页红幅小三角改瞄胶囊内三个点的中心（左缘起 24% 宽处），
 *   不再瞄胶囊正中（真机截图量测旧口径偏右约 63/976 屏宽）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const ROOT = path.join(__dirname, '..');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('BE白色服务条整体删除：组件、挂载、注册、状态全清', () => {
  assert(!fs.existsSync(path.join(ROOT, 'miniprogram/components/top-banner')), 'top-banner 组件目录应不存在');
  assert(!rd('miniprogram/pages/index/index.wxml').includes('top-banner'), '首页 wxml 无 top-banner');
  assert(!rd('miniprogram/pages/index/index.json').includes('top-banner'), '首页 json 无 top-banner 注册');
  assert(!rd('miniprogram/pages/index/index.js').includes('topBanner'), '首页 js 无 topBanner 调用');
  const app = rd('miniprogram/app.js');
  assert(!app.includes('topBanner') && !app.includes('appShowTick'), 'app.js 无顶条状态残留');
});

test('BE我的页取消家庭共享入口：行与处理函数删除、横置行保留', () => {
  const wxml = rd('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  assert(!wxml.includes('家庭共享'), '我的页不得再有家庭共享行');
  assert(!wxml.includes('onShareHome'), '我的页不得再绑 onShareHome');
  assert(wxml.includes('横置礼单本'), '横置礼单本行保留');
  const js = rd('miniprogram/pages/mine/mine.js');
  assert(!js.includes('onShareHome'), 'mine.js 不得留 onShareHome 处理函数');
  // 家庭共享功能本身保留（首页入口与共享页都在）
  assert(rd('miniprogram/pages/index/index.js').includes('share'), '首页共享入口保留');
  assert(fs.existsSync(path.join(ROOT, 'miniprogram/pages/share/share-home.wxml')), '共享首页保留');
});

test('BE红幅三角瞄三个点：按胶囊左缘起 24% 宽算、不再瞄正中', () => {
  const js = rd('miniprogram/pages/mine/mine.js');
  assert(js.includes('rect.width * 0.24'), '三角应对准三个点中心（胶囊左缘起 24% 宽）');
  assert(!js.includes('rect.left + rect.width / 2'), '不得再按胶囊正中算三角位置');
});

test('BF补充字库无延迟：命中的补充片在就绪盖揭开前先加载完', () => {
  const js = rd('miniprogram/pages/landscape/book-common.js');
  const awaitIdx = js.indexOf('await fontManager.ensureSupplements(suppChunks, this.data.fontId)');
  const readyIdx = js.indexOf('this.setData({ ready: true })');
  assert(awaitIdx > 0, 'onLoad 应在就绪前等待补充片加载');
  assert(readyIdx > awaitIdx, '补充片加载必须排在 ready 之前（打开第一眼就是枝芒、不跳变）');
});
