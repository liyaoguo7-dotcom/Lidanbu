/** DE批（用户 2026-10-30 定，取代 CG/CR 的冻结区结构）：
 * 礼薄详情从上到下：搜索框（单独吸顶）→ 头像头（图案＋标签，滚动）→
 * 礼薄名＋日期＋共计（一块吸顶在搜索框下，top＝搜索栏高 54px）→ 联系人；
 * 名字只出现一次，用原来 20px 加粗（不用 CR 的 16px 不加黑固定行）。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DE 礼薄详情：搜索吸顶＋头像滚动＋名日期共计吸顶＋名字一次20px加粗', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.pat-head { background: #F7F3EA; padding: 6px 0 0; text-align: center; }'), '头像头仍居中（标签居中）');
  const searchIdx = wxml.indexOf('class="card search-stick"');
  const searchbarIdx = wxml.indexOf('class="searchbar"', searchIdx);
  const headCardIdx = wxml.indexOf('class="card head-card"');
  const patHeadIdx = wxml.indexOf('class="pat-head', headCardIdx);
  const infoIdx = wxml.indexOf('class="card info-stick'); /* DO批：吸顶块后加白事类插值，改前缀匹配 */
  const nameIdx = wxml.indexOf('class="event-name"', infoIdx);
  const dateIdx = wxml.indexOf('class="event-date', infoIdx);
  const totalIdx = wxml.indexOf('event-total', infoIdx);
  const patCardIdx = wxml.indexOf('class="card pat-card"');
  assert(searchIdx >= 0 && searchbarIdx > searchIdx, '搜索框在单独的吸顶容器内');
  assert(headCardIdx > searchIdx && patHeadIdx > headCardIdx, '头像头在搜索框之后');
  assert(infoIdx > headCardIdx && nameIdx > infoIdx && dateIdx > nameIdx && totalIdx > dateIdx, '吸顶块顺序：名→日期→共计，且在头像头之后');
  assert(patCardIdx > totalIdx, '记录卡在吸顶块之后');
  assert(!wxml.includes('detail-head') && !wxml.includes('event-stick'), '旧冻结容器与 16px 固定名行不得残留');
  const nameEls = (wxml.match(/class="event-name"/g) || []).length;
  assert(nameEls === 1, '礼薄名只渲染一处（去重，旧两处重复已修）');
  const headCard = wxml.slice(headCardIdx, infoIdx);
  assert(!headCard.includes('event-name') && !headCard.includes('event-date') && !headCard.includes('total-line'), '头像头只剩图案＋标签（名／日期／共计已移出）');
  assert(wxss.includes('.search-stick { position: sticky; top: 0; z-index: 10; padding: 0; margin: 0 12px; border-radius: 12px; }'), '搜索框吸顶贴顶＋全圆角');
  assert(wxss.includes('.info-stick { position: sticky; top: 54px; z-index: 10; padding: 0; margin: 0 12px 10px; border-radius: 12px; text-align: center; }'), '名日期共计块吸顶在搜索框下（top 54px＝搜索栏高）＋居中');
  assert(wxss.includes('.event-name { font-size: 20px; font-weight: 700;'), '礼薄名用原来 20px 加粗（取代 CR 的 16px 不加黑）');
  assert(wxss.includes('.head-card { overflow: hidden; }'), '头像头独立成卡圆角裁剪');
  assert(wxss.includes('.pat-card { text-align: center; padding: 0; position: relative; overflow: hidden; margin: 0 12px 10px; border-radius: 12px; }'), '记录卡独立全圆角');
  assert(wxml.includes('wx:if="{{!searching}}"'), '共计搜索时隐藏（与原共计一致）');
});
