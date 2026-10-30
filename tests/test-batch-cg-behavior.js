/** DE批（用户 2026-10-30 定）同步：CG 的冻结区结构已被 DE 取代——
 * 搜索框单独吸顶，头像头（图案＋标签）滚动，礼薄名＋日期＋共计一块吸顶；
 * 名字只出现一次，用原来 20px 加粗。本文件保留 CG 的居中／圆角断言，结构断言以 DE 为准。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CG 礼薄详情：礼薄名居中＋头像头滚动（结构以 DE 为准）', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.pat-head { background: #F7F3EA; padding: 6px 0 0; text-align: center; }'), '头像头恢复居中（礼薄名不再偏左）');
  const searchIdx = wxml.indexOf('class="card search-stick"');
  const searchbarIdx = wxml.indexOf('class="searchbar"', searchIdx);
  const headCardIdx = wxml.indexOf('class="card head-card"');
  const patHeadIdx = wxml.indexOf('class="pat-head', headCardIdx);
  const infoIdx = wxml.indexOf('class="card info-stick'); /* DO批：吸顶块后加白事类插值，改前缀匹配 */
  const patCardIdx = wxml.indexOf('class="card pat-card"');
  assert(searchIdx >= 0 && searchbarIdx > searchIdx, '搜索框在单独的吸顶容器内（DE 取代 CG 的 detail-head）');
  assert(headCardIdx > searchIdx && patHeadIdx > headCardIdx && infoIdx > headCardIdx && patCardIdx > infoIdx, '头像头在搜索框之后、随滚动上去，吸顶块与记录卡在其后');
  assert(wxss.includes('.search-stick { position: sticky; top: 0; z-index: 10; padding: 0; margin: 0 12px; border-radius: 12px; }'), '搜索吸顶贴顶＋全圆角');
  assert(wxss.includes('.info-stick { position: sticky; top: 54px;'), '名日期共计块吸顶在搜索框下');
  assert(wxss.includes('.head-card { overflow: hidden; }'), '头像头独立成卡圆角裁剪');
  assert(wxss.includes('border-radius: 12px; }') && wxss.includes('.pat-card { text-align: center; padding: 0; position: relative; overflow: hidden; margin: 0 12px 10px; border-radius: 12px; }'), '记录卡独立全圆角');
});
