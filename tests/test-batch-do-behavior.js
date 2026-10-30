/** DR批（用户 2026-10-31 定，取代 DO 的吸顶块口径）：
 * 礼薄详情第一方块底色首页收礼最左浅色 #FFE4B8，第二方块共计 total-stick
 * 底色送礼页横置栏改动前淡黄 #FBF3D9（不再与头像共计同淡米）；白事均为淡灰；
 * 滑动与吸顶位置、搜索框、记录列表、字号颜色全不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DO 礼薄详情（DR批）：共计吸顶块淡黄＋第一方块收礼浅色＋滑动不动', () => {
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  assert(wxss.includes('.card.total-stick { background: #FBF3D9; }'), '共计吸顶块喜事淡黄（DR批：与送礼共计同色，DO 淡米作废）');
  assert(wxss.includes('.card.total-stick.baishi { background: #F2F2F2; }'), '共计吸顶块白事淡灰');
  assert(wxss.includes('.card.head-card { background: #FFE4B8;'), '第一方块喜事底色首页收礼最左浅色（DR批）');
  assert(wxss.includes('.card.head-card.baishi { background: #F2F2F2; }'), '第一方块白事淡灰');
  assert(wxml.includes('class="card total-stick {{isBaishi ? \'baishi\' : \'\'}}"'), '共计吸顶块带白事类切换');
  assert(wxss.includes('.total-stick { position: sticky; top: 54px;'), '吸顶位置 top 54px 不动');
  assert(wxss.includes('.search-stick { position: sticky; top: 0;'), '搜索框吸顶不动');
  assert(wxss.includes('.event-name { font-size: 20px; font-weight: 700;'), '礼薄名字号加粗不动');
  assert(wxss.includes('.event-date { font-size: 13px; color: #C2C2C2;'), '日期颜色不动');
});
