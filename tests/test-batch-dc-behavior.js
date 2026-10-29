/** DC批（用户 2026-10-29 选 B）：往来页取消 BA 固定头——
 * 整页恢复正常滑动，时间标签随页滑走；搜索框＋收送两块＋合计卡包一层
 * sticky，滑到顶部时整组吸顶固定，下面只剩联系人滑动。搜索时两块与合计卡
 * 隐藏，只剩搜索框吸顶；sticky 底色取整页底色 #F6F6F6，联系人滑过时缝隙
 * 不露白；DA 横滑手势不受影响。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DC 往来页 sticky 组：时间标签滑走、搜索＋对照＋合计吸顶、只剩联系人滑动', () => {
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  const wxss = readMp('pages/wanglai/wanglai.wxss');
  const iTimerow = wxml.indexOf('class="timerow"');
  const iSticky = wxml.indexOf('class="wl-sticky"');
  const iSearch = wxml.indexOf('class="searchbar"');
  const iBlock = wxml.indexOf('wx:if="{{!searching}}"', iSearch);
  const iCompare = wxml.indexOf('class="compare"');
  const iSummary = wxml.indexOf('class="summary-card"');
  const iList = wxml.indexOf('class="wl-list"');
  assert(iTimerow >= 0 && iTimerow < iSticky, '时间标签在 sticky 组之上、随页滑走');
  assert(iSticky < iSearch, '搜索框在 sticky 组内');
  assert(iSearch < iBlock && iBlock < iCompare, '搜索框不随搜索隐藏、两块与合计卡只在非搜索时显示（搜索时只剩搜索框吸顶）');
  assert(iCompare < iSummary && iSummary < iList, '对照＋合计在 sticky 组内、列表之前');
  assert(/\.wl-sticky\s*\{[^}]*position: sticky[^}]*top: 0[^}]*z-index: 10[^}]*background: #F6F6F6/.test(wxss), 'sticky 组吸顶 top:0、层级 10、底色 #F6F6F6');
  assert(!wxml.includes('<scroll-view') && wxml.includes('<view class="wl-list">'), '列表不再独立滚动、随整页滑动');
  assert(wxml.includes('bindtouchstart="onTabSwipeStart"') && wxml.includes('bindtouchmove="onTabSwipeMove"'), 'DA 横滑手势仍在整页根节点');
});
