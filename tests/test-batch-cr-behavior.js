/** DE批（用户 2026-10-30 定，取代 CR 的冻结区）：
 * 搜索框单独吸顶；头像头（图案＋标签）滚上去；礼薄名＋日期＋共计一块吸顶；
 * 名字只出现一次，用原来 20px 加粗（CR 的 16px 不加黑固定行作废）；
 * 共计条底色同头部（喜事淡米，白事淡灰），与日期行留 6px 白隙、自身全圆角；
 * 搜索时共计隐藏（与原共计一致）。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CR 礼薄详情吸顶块：名日期共计吸顶、名 20px 加粗、头像头无名无共计', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.search-stick { position: sticky; top: 0; z-index: 10;'), '搜索框仍贴顶 sticky');
  assert(wxss.includes('.info-stick { position: sticky; top: 54px;'), '名日期共计块吸顶在搜索框下');
  assert(wxml.includes('<text class="event-name" wx:if="{{event.name}}">{{event.name}}</text>'), '吸顶块礼薄名在位（只出现一次）');
  assert(wxss.includes('.event-name { font-size: 20px; font-weight: 700;'), '礼薄名用原来 20px 加粗（CR 的 16px 不加黑作废）');
  assert(!wxml.includes('event-stick') && !wxss.includes('.event-stick'), '旧 16px 固定名行不得残留');
  const stick = '<view class="total-line event-total {{isBaishi ? \'baishi\' : \'\'}}" wx:if="{{!searching}}"><text>共计：</text><text class="red num">{{totalCount}}</text><text>笔 ¥</text><text class="red num">{{totalAmountText}}</text><text>元</text></view>';
  assert(wxml.includes(stick), '吸顶块共计条（与原共计同一格式，搜索时隐藏）');
  assert(wxml.indexOf('event-total') > wxml.indexOf('pat-head'), '共计条在头像头之后（吸顶块内）');
  assert(wxml.indexOf('event-total') > wxml.indexOf('event-date'), '共计条在日期行之后（名→日期→共计）');
  const headCard = wxml.slice(wxml.indexOf('head-card'), wxml.indexOf('info-stick'));
  assert(!headCard.includes('total-line') && !headCard.includes('event-name') && !headCard.includes('event-date'), '头像头不再含名／日期／共计（不重复）');
  assert(wxss.includes('.event-total { background: #F7F3EA; border-radius: 12px; margin: 6px 0 0; }'), '共计条喜事淡米＋全圆角＋与日期行留隙');
  assert(wxss.includes('.event-total.baishi { background: #F2F2F2; }'), '共计条白事淡灰');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px;'), '共计仍居中 20px 大字（复用原规则）');
});
