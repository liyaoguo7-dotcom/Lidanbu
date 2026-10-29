/** DM批（用户 2026-10-30 定）：往来页搜索框上面整片（时间标签＋日期）改首页
 * 四大金刚共用的白底 #FFFFFF；搜索框、送礼／收礼两块、合计卡、联系人、
 * 时间标签各自颜色全不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DM 往来页：搜索框上面整片改白底，其余不动', () => {
  const wxss = readMp('pages/wanglai/wanglai.wxss');
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  assert(wxss.includes('.wl-page {') && wxss.includes('background: #fff;'), '整页根改白底（搜索框上面一片随之变白）');
  assert(wxss.includes('.wl-sticky {') && wxss.includes('background: #F6F6F6;'), '吸顶组底色仍浅灰不动');
  assert(wxss.includes('.side:first-child { background: linear-gradient(135deg, #FFC7C3, #F78C8F); }'), '送礼块粉渐变不动');
  assert(wxss.includes('.side:last-child { background: linear-gradient(135deg, #FFE4B8, #FDBE68); }'), '收礼块橙渐变不动');
  assert(wxss.includes('.tchip.chip-all { background: #E2EEFB; }'), '时间标签各自颜色不动');
  assert(wxml.includes('class="timerow"') && wxml.includes('class="daterange num"') && wxml.includes('class="searchbar"'), '时间标签、日期、搜索框结构不动');
  assert(wxss.includes('.wl-list { background: #fff; }'), '联系人列表白底不动');
});
