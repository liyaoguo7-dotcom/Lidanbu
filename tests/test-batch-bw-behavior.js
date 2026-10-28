/** BW批：首页小结＋最近往来缓存秒显（用户 2026-10-28 定为正式上线质量红线）：
 * 根因：每次 onShow 都重查云端，查回来的 1-2 秒里 recent=[]、卡片不渲染，
 * 看着就是姓名没了、然后又出来。修法：本地缓存先秒显，后台静默重查换新；
 * 换号不闪旧账（缓存按 uid 校验）；无缓存首次显示加载中；刷新失败留旧缓存不弹错。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');

test('BW 首页缓存秒显：先读缓存秒显、后台重查换新、失败留旧', () => {
  const js = readMp('pages/index/index.js');
  assert(js.includes("wx.getStorageSync('home.cache.v1')"), '读首页缓存');
  assert(js.includes("wx.setStorageSync('home.cache.v1'"), '写首页缓存');
  assert(js.includes('c.uid !== uid'), '缓存按 uid 校验、换号不用旧账');
  assert(js.includes('_applyHomeData(cached.monthSummary, cached.recent)'), '有缓存先秒显');
  assert(js.includes('_writeHomeCache(monthSummary, list)'), '查回新数据后更新缓存');
  const refreshBlock = js.slice(js.indexOf('async refreshHomeData()'), js.indexOf('goWanglai()'));
  assert(!refreshBlock.includes('showToast'), '静默刷新失败不弹错');
  assert(refreshBlock.includes('homeLoading: false'), '刷新收尾关加载态');
});

test('BW 首页无缓存首次：显示加载中、不留空白', () => {
  const wxml = readMp('pages/index/index.wxml');
  assert(wxml.includes('wx:if="{{homeLoading}}"'), '加载态视图在位');
  assert(wxml.includes('加载中…'), '加载中文案在位');
  const wxss = readMp('pages/index/index.wxss');
  assert(wxss.includes('.recent-loading'), '加载态样式在位');
  const js = readMp('pages/index/index.js');
  assert(js.includes('homeLoading: false'), 'homeLoading 初始 false');
});

test('BW 缓存归属：data-service 提供当前用户 id', () => {
  const ds = readMp('services/data-service.js');
  assert(ds.includes('getCurrentUserId()'), 'getCurrentUserId 在位');
});
