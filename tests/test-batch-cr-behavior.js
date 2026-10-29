/** CR批（用户 2026-10-29 定，截图 mockup 为准）：礼薄详情往上滚动后，
 * 搜索框下的礼薄名＋共计停在那里冻结，下边联系人继续滚动。
 * 冻结区＝搜索框＋礼薄名（不加黑）＋共计条；头像头（含原共计）滚上去；
 * 共计条底色同头部（喜事淡米，白事淡灰），与名行留 6px 白隙、自身全圆角；
 * 搜索时共计隐藏（与原共计一致）。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CR 礼薄详情冻结区：名＋共计冻结、名不加黑、头像头无共计', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.detail-head { position: sticky; top: 0; z-index: 10;'), '冻结容器仍贴顶 sticky');
  assert(wxml.includes('<view class="event-stick" wx:if="{{event.name}}"><text>{{event.name}}</text></view>'), '冻结区礼薄名在位');
  assert(wxss.includes('.event-stick { text-align: center; font-size: 16px; font-weight: 400;'), '礼薄名不加黑（400，取代 CG 的 700）');
  assert(!wxss.includes('.event-stick { text-align: center; font-size: 16px; font-weight: 700;'), '旧加黑规则不得残留');
  const stick = '<view class="total-line event-total {{isBaishi ? \'baishi\' : \'\'}}" wx:if="{{!searching}}"><text>共计：</text><text class="red num">{{totalCount}}</text><text>笔 ¥</text><text class="red num">{{totalAmountText}}</text><text>元</text></view>';
  assert(wxml.includes(stick), '冻结区共计条（与原共计同一格式，搜索时隐藏）');
  assert(wxml.indexOf('event-total') < wxml.indexOf('pat-head'), '共计条在头像头之前（冻结区内）');
  const headCard = wxml.slice(wxml.indexOf('head-card'));
  assert(!headCard.includes('total-line'), '头像头不再含共计（不重复）');
  assert(wxss.includes('.event-total { background: #F7F3EA; border-radius: 12px; margin: 6px 0 0; }'), '共计条喜事淡米＋全圆角＋与名行留隙');
  assert(wxss.includes('.event-total.baishi { background: #F2F2F2; }'), '共计条白事淡灰');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px;'), '共计仍居中 20px 大字（复用原规则）');
});
