/** CM批（用户 2026-10-29 定）：横置礼单纸面纹路跟着联系人一起滚——
 * 纹路背景从固定层 .paper 移到滚动内容 .cols-track 上；min-width:100%
 * 保证联系人少、不用滚时整幅纸面仍有纹路；两头卷轴杆子与角花不动
 * （框）；六个样式共用同一处（gift/receive 两页同引 book 模板）。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CM 横置纸面纹路随联系人滚动', () => {
  const wxml = readMp('pages/landscape/book.wxml');
  const wxss = readMp('pages/landscape/book.wxss');
  const paper = wxml.slice(wxml.indexOf('<view class="paper"'), wxml.indexOf('<scroll-view'));
  assert(!paper.includes('background-image:'), '纹路不再画在固定层 .paper 上');
  assert(paper.includes('background-color:{{theme.paperBg}};'), '纸面底色仍在 .paper 上（兜底）');
  const track = wxml.slice(wxml.indexOf('<view class="cols-track"'), wxml.indexOf('wx:for="{{cols}}"'));
  assert(track.includes('background-image:url({{theme.paperTile.uri}});'), '纹路画在滚动内容 .cols-track 上');
  assert(track.includes('background-size:{{view.paperTileW}}px {{view.paperTileH}}px;'), '纹路尺寸绑定不动');
  const trackCss = wxss.slice(wxss.indexOf('.cols-track {'), wxss.indexOf('.col {'));
  assert(trackCss.includes('min-width: 100%;'), '滚动内容至少铺满纸面宽');
  assert(trackCss.includes('background-repeat: repeat;'), '纹路平铺');
  assert(wxml.includes('<image class="scroll-img"') && wxml.includes('class="scroll-img flip"'), '两头卷轴杆子不动');
  assert(!wxml.includes('class="corner'), '角花全部去掉（CN批，取代 CM 的角花不动）');
  assert(readMp('pages/landscape/gift/gift.wxml').includes('<import src="../book.wxml" />'), '送礼页同引 book 模板');
  assert(readMp('pages/landscape/receive/receive.wxml').includes('<import src="../book.wxml" />'), '收礼页同引 book 模板');
});
