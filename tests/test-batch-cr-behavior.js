/** DR批（用户 2026-10-31 定，取代 DE/CR 的冻结区结构）：
 * 搜索框单独吸顶；第一方块（图案＋标签＋礼薄名＋日期）滚动；
 * 共计单独成第二方块 total-stick 吸顶在搜索框下（top 54px）；
 * 名字只出现一次，用原来 20px 加粗；第一方块底色首页收礼最左浅色，
 * 共计块底色送礼页横置栏改动前淡黄，白事均为淡灰；搜索时共计隐藏。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CR 礼薄详情吸顶块（DR批）：名日期在第一方块滚动、共计单独吸顶、名 20px 加粗', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.search-stick { position: sticky; top: 0; z-index: 10;'), '搜索框仍贴顶 sticky');
  assert(wxss.includes('.total-stick { position: sticky; top: 54px;'), '共计块吸顶在搜索框下');
  const headCardIdx = wxml.indexOf('class="card head-card');
  const nameIdx = wxml.indexOf('class="event-name"', headCardIdx);
  const dateIdx = wxml.indexOf('class="event-date', headCardIdx);
  const totalIdx = wxml.indexOf('class="card total-stick');
  assert(headCardIdx >= 0 && nameIdx > headCardIdx && dateIdx > nameIdx && totalIdx > dateIdx, '顺序：第一方块→礼薄名→日期→共计吸顶块');
  assert(wxml.includes('<text class="event-name" wx:if="{{event.name}}">{{event.name}}</text>'), '礼薄名在位（只出现一次）');
  assert(wxss.includes('.event-name { font-size: 20px; font-weight: 700;'), '礼薄名用原来 20px 加粗');
  assert(!wxml.includes('event-stick') && !wxml.includes('info-stick') && !wxml.includes('event-total'), '旧 16px 固定名行与 info-stick/event-total 不得残留（DR批拆除）');
  const headCard = wxml.slice(headCardIdx, totalIdx);
  assert(headCard.includes('event-name') && headCard.includes('event-date') && !headCard.includes('total-line'), '第一方块含名／日期、不含共计（共计在第二方块）');
  assert(wxss.includes('.card.total-stick { background: #FBF3D9; }'), '共计块喜事淡黄（DR批：与送礼共计同色，DE 淡米作废）');
  assert(wxss.includes('.card.total-stick.baishi { background: #F2F2F2; }'), '共计块白事淡灰');
  assert(wxss.includes('.card.head-card { background: #FFE4B8;'), '第一方块喜事底色首页收礼最左浅色');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px;'), '共计仍居中 20px 大字');
  assert(wxml.includes('wx:if="{{!searching}}"'), '共计搜索时隐藏（与原共计一致）');
});
