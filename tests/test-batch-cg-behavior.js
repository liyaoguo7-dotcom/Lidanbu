/** CG批（用户 2026-10-29 定）：
 * 1. 礼薄名偏左原因：BX冻结重构时头部脱离带 text-align:center 的 .pat-card，
 *    新容器没有居中规则，标签／礼薄名／日期全部偏左（共计因自身居中未受影响）；
 *    与导入联系人无关（导入只写记录，改不了样式）。修复：.pat-head 恢复居中。
 * 2. 头像头不再固定，随联系人一起滚上去；只在搜索框下固定一行显示礼薄名
 *    （搜索框＋礼薄名同一 sticky 容器）；记录卡独立全圆角。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CG 礼薄详情：礼薄名居中＋搜索框下固定一行礼薄名＋头像头滚动', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.pat-head { background: #F7F3EA; padding: 6px 0 0; text-align: center; }'), '头像头恢复居中（礼薄名不再偏左）');
  const headIdx = wxml.indexOf('class="card detail-head"');
  const searchIdx = wxml.indexOf('class="searchbar"', headIdx);
  const stickIdx = wxml.indexOf('class="event-stick"', headIdx);
  const headCardIdx = wxml.indexOf('class="card head-card"');
  const patHeadIdx = wxml.indexOf('class="pat-head', headCardIdx);
  const patCardIdx = wxml.indexOf('class="card pat-card"');
  assert(headIdx >= 0 && searchIdx > headIdx && stickIdx > searchIdx, '搜索框＋礼薄名行在同一固定容器内');
  assert(wxml.includes('<view class="event-stick" wx:if="{{event.name}}"><text>{{event.name}}</text></view>'), '固定行显示礼薄名');
  assert(headCardIdx > stickIdx && patHeadIdx > headCardIdx && patCardIdx > patHeadIdx, '头像头在固定容器之外、随滚动上去，记录卡在其后');
  assert(wxss.includes('.detail-head { position: sticky; top: 0; z-index: 10; padding: 0; margin: 0 12px; border-radius: 12px; }'), '固定容器 sticky 贴顶＋全圆角');
  assert(wxss.includes('.event-stick { text-align: center;'), '固定行礼薄名居中');
  assert(wxss.includes('text-overflow: ellipsis;'), '固定行单行超出省略');
  assert(wxss.includes('.head-card { overflow: hidden; }'), '头像头独立成卡圆角裁剪');
  assert(wxss.includes('border-radius: 12px; }') && wxss.includes('.pat-card { text-align: center; padding: 0; position: relative; overflow: hidden; margin: 0 12px 10px; border-radius: 12px; }'), '记录卡独立全圆角');
});
