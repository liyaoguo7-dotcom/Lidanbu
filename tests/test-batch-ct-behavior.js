/** CT批（用户 2026-10-29 定）：送礼记录页固定头＋独立滚动。
 * 搜索框＋横置入口（显示时）＋共计块固定在顶部不动，记录只在下方
 * 滚动区里滚（仿往来页），不再从共计块下面冒出半行字；共计文字居中、
 * 上下收短（14/12→8/6）；记录行去掉淡色底、恢复纯白；共计块米黄
 * #F7F3EA；横置块首页拍照导入粉 #FDE8E8；两块各一块、中间留 10px 隙。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CT 送礼页固定头＋独立滚动＋两块颜色', () => {
  const wxml = readMp('pages/gifts/gifts.wxml');
  const wxss = readMp('pages/gifts/gifts.wxss');
  assert(wxss.includes('.gifts-page { display: flex; flex-direction: column; height: 100vh;'), '整页 100vh 纵向 flex');
  assert(wxss.includes('.gift-scroll { flex: 1; height: 0; background: #fff; }'), '记录区独立滚动＋纯白底');
  const order = ['searchbar', 'entry-row', 'total-line', 'gift-scroll', 'list-card', 'tabbar-spacer'];
  let prev = -1;
  for (const k of order) {
    const i = wxml.indexOf(k);
    assert(i > prev, `${k} 顺序在前一项之后`);
    prev = i;
  }
  assert(wxml.indexOf('class="fab"') > wxml.indexOf('</scroll-view>'), '＋按钮在滚动区外（固定）');
  assert(wxml.indexOf('<tab-bar') > wxml.indexOf('</scroll-view>'), '自定义 Tab 栏在滚动区外（固定）');
  assert(wxml.indexOf('tabbar-spacer') < wxml.indexOf('</scroll-view>'), 'Tab 栏占位在滚动区内（末行不被遮挡）');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px; padding: 8px 16px 6px; color: #333; background: #F7F3EA; border-radius: 12px; margin: 10px 12px 0; }'), '共计块米黄＋居中＋收短＋全圆角＋与横置块留隙');
  assert(!wxss.includes('position: sticky'), '本页无 sticky');
  assert(wxss.includes('.card.entry-row { margin-top: 0; margin-bottom: 0; background: #FBF3D9; }'), '横置块本月淡黄（CZ批，取代 CT批拍照导入粉）');
  assert(wxss.includes('.disc-photo { background: #FDE8E8; }') || readMp('pages/index/index.wxss').includes('.disc-photo { background: #FDE8E8; }'), '拍照导入粉对照 #FDE8E8');
  assert(!wxml.includes('gift-row rowbg'), '记录行无淡色底（纯白）');
  assert(wxml.includes('<text>共计：</text><text class="red num">{{totalCount}}</text><text>笔 ¥</text><text class="red num">{{totalAmountText}}</text>'), '共计分段格式不变');
  assert(wxml.indexOf('class="total-line"') < wxml.indexOf('class="gift-scroll"'), '共计块在滚动区外（固定）');
});
