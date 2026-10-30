/** DR批（用户 2026-10-31 定，取代 DE/CG 的冻结区结构）：
 * 搜索框单独吸顶，第一方块（图案＋标签＋礼薄名＋日期）滚动，
 * 第二方块（共计 total-stick）吸顶在搜索框下；两块都圆角、中间留隙；
 * 名字只出现一次，用原来 20px 加粗；第一方块底色首页收礼最左浅色，
 * 共计块底色送礼页横置栏改动前淡黄，白事均为淡灰。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CG 礼薄详情：礼薄名居中＋头像头滚动（结构以 DR 为准）', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.pat-head { padding: 6px 0 0; text-align: center; }'), '头像头恢复居中（礼薄名不再偏左；底色已移到 head-card 整块，DR批）');
  assert(wxss.includes('.card.head-card { background: #FFE4B8;'), '第一方块喜事底色首页收礼最左浅色（DR批）');
  const searchIdx = wxml.indexOf('class="card search-stick"');
  const searchbarIdx = wxml.indexOf('class="searchbar"', searchIdx);
  const headCardIdx = wxml.indexOf('class="card head-card');
  const patHeadIdx = wxml.indexOf('class="pat-head', headCardIdx);
  const nameIdx = wxml.indexOf('class="event-name"', headCardIdx);
  const dateIdx = wxml.indexOf('class="event-date', headCardIdx);
  const totalIdx = wxml.indexOf('class="card total-stick'); /* DR批：共计单独吸顶，取代 info-stick */
  const patCardIdx = wxml.indexOf('class="card pat-card"');
  assert(searchIdx >= 0 && searchbarIdx > searchIdx, '搜索框在单独的吸顶容器内');
  assert(headCardIdx > searchIdx && patHeadIdx > headCardIdx && nameIdx > patHeadIdx && dateIdx > nameIdx, '第一方块顺序：头像头→礼薄名→日期，且在搜索框之后、随滚动上去');
  assert(totalIdx > headCardIdx && patCardIdx > totalIdx, '共计吸顶块在第一方块之后、记录卡在其后');
  assert(!wxml.includes('info-stick') && !wxml.includes('event-total'), '旧 info-stick/event-total 结构不得残留（DR批拆除）');
  assert(wxss.includes('.search-stick { position: sticky; top: 0; z-index: 10; padding: 0; margin: 0 12px; border-radius: 12px; }'), '搜索吸顶贴顶＋全圆角');
  assert(wxss.includes('.total-stick { position: sticky; top: 54px;'), '共计块吸顶在搜索框下');
  assert(wxss.includes('.card.head-card { background: #FFE4B8; overflow: hidden;'), '头像头独立成卡圆角裁剪');
  assert(wxss.includes('border-radius: 12px; }') && wxss.includes('.pat-card { text-align: center; padding: 0; position: relative; overflow: hidden; margin: 0 12px 10px; border-radius: 12px; }'), '记录卡独立全圆角');
});
