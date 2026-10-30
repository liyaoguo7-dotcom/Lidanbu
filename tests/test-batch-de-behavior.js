/** DR批（用户 2026-10-31 定，取代 DE/CG/CR 的冻结区结构）：
 * 礼薄详情从上到下：搜索框（单独吸顶）→ 第一方块（图案＋标签＋礼薄名＋日期，
 * 滚动）→ 共计（第二方块 total-stick，吸顶在搜索框下，top＝搜索栏高 54px）→ 联系人；
 * 名字只出现一次，用原来 20px 加粗；第一方块底色首页收礼最左浅色，
 * 共计块底色送礼页横置栏改动前淡黄，白事均为淡灰。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DE 礼薄详情（DR批）：搜索吸顶＋第一方块滚动＋共计单独吸顶＋名字一次20px加粗', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.pat-head { padding: 6px 0 0; text-align: center; }'), '头像头仍居中（标签居中；底色已移到 head-card 整块，DR批）');
  const searchIdx = wxml.indexOf('class="card search-stick"');
  const searchbarIdx = wxml.indexOf('class="searchbar"', searchIdx);
  const headCardIdx = wxml.indexOf('class="card head-card');
  const patHeadIdx = wxml.indexOf('class="pat-head', headCardIdx);
  const nameIdx = wxml.indexOf('class="event-name"', headCardIdx);
  const dateIdx = wxml.indexOf('class="event-date', headCardIdx);
  const totalIdx = wxml.indexOf('class="card total-stick'); /* DR批：共计单独吸顶，取代 info-stick */
  const patCardIdx = wxml.indexOf('class="card pat-card"');
  assert(searchIdx >= 0 && searchbarIdx > searchIdx, '搜索框在单独的吸顶容器内');
  assert(headCardIdx > searchIdx && patHeadIdx > headCardIdx, '头像头在搜索框之后');
  assert(nameIdx > patHeadIdx && dateIdx > nameIdx && totalIdx > dateIdx, '第一方块顺序：头像头→名→日期，其后是共计吸顶块');
  assert(patCardIdx > totalIdx, '记录卡在共计吸顶块之后');
  assert(!wxml.includes('detail-head') && !wxml.includes('event-stick') && !wxml.includes('info-stick'), '旧冻结容器、16px 固定名行与 info-stick 不得残留');
  const nameEls = (wxml.match(/class="event-name"/g) || []).length;
  assert(nameEls === 1, '礼薄名只渲染一处（去重，旧两处重复已修）');
  const headCard = wxml.slice(headCardIdx, totalIdx);
  assert(headCard.includes('event-name') && headCard.includes('event-date') && !headCard.includes('total-line'), '第一方块含名／日期、不含共计（共计已移到第二方块）');
  assert(wxss.includes('.search-stick { position: sticky; top: 0; z-index: 10; padding: 0; margin: 0 12px; border-radius: 12px; }'), '搜索框吸顶贴顶＋全圆角');
  assert(wxss.includes('.total-stick { position: sticky; top: 54px; z-index: 10; padding: 0; margin: 0 12px 10px; border-radius: 12px; text-align: center; }'), '共计块吸顶在搜索框下（top 54px＝搜索栏高）＋居中');
  assert(wxss.includes('.event-name { font-size: 20px; font-weight: 700;'), '礼薄名用原来 20px 加粗');
  assert(wxss.includes('.card.head-card { background: #FFE4B8; overflow: hidden;'), '头像头独立成卡圆角裁剪');
  assert(wxss.includes('.pat-card { text-align: center; padding: 0; position: relative; overflow: hidden; margin: 0 12px 10px; border-radius: 12px; }'), '记录卡独立全圆角');
  assert(wxml.includes('wx:if="{{!searching}}"'), '共计搜索时隐藏（与原共计一致）');
});
