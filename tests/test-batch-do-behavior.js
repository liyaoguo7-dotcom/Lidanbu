/** DO批（用户 2026-10-30 定）：礼薄详情吸顶块（名＋日期＋共计）本身改与头像、
 * 共计同色（喜事淡米 #F7F3EA／白事淡灰 #F2F2F2），名＋日期不再透卡片白底；
 * 滑动与吸顶位置、搜索框、记录列表、字号颜色全不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DO 礼薄详情：吸顶块与头像共计一色＋滑动不动', () => {
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  assert(wxss.includes('.card.info-stick { background: #F7F3EA; }'), '吸顶块喜事淡米与头像共计同色');
  assert(wxss.includes('.card.info-stick.baishi { background: #F2F2F2; }'), '吸顶块白事淡灰与头像共计同色');
  assert(wxss.includes('.pat-head { background: #F7F3EA;'), '头像块淡米不动');
  assert(wxss.includes('.event-total { background: #F7F3EA;'), '共计块淡米不动');
  assert(wxml.includes('class="card info-stick {{isBaishi ? \'baishi\' : \'\'}}"'), '吸顶块带白事类切换');
  assert(wxss.includes('.info-stick { position: sticky; top: 54px;'), '吸顶位置 top 54px 不动');
  assert(wxss.includes('.search-stick { position: sticky; top: 0;'), '搜索框吸顶不动');
  assert(wxss.includes('.event-name { font-size: 20px; font-weight: 700;'), '礼薄名字号加粗不动');
  assert(wxss.includes('.event-date { font-size: 13px; color: #C2C2C2;'), '日期颜色不动');
});
