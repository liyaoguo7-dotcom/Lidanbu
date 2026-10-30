/** DF批（用户 2026-10-30 定）：
 * ①核对页送礼场合与收礼类型弃原生滚动轮盘、改弹面板平铺：场合 10 个两排每排 5 个，
 *   类型 5 个一排 5 个，点格子选中、点确定生效、点取消不变；选亲友面板不动。
 * ②送礼记录页顶部共计：米黄改首页送礼粉红渐变，笔数和金额数字改白字（标签字仍深色）。
 * ③收礼主页礼薄名：名本身背景改首页收礼橙黄渐变（每名各一块、圆角12px）；
 *   名字黑色不动，日期与共几笔由 #C2C2C2 加深到 #666，金额不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DF 核对页：场合与类型平铺面板（无原生轮盘、每排5格、确定生效取消不变）', () => {
  const wxml = readMp('pages/import/import-review.wxml');
  const js = readMp('pages/import/import-review.js');
  const wxss = readMp('pages/import/import-review.wxss');
  assert(!wxml.includes('mode="selector"'), '场合与类型不再用原生滚动轮盘（日期仍是 mode="date"，不在此列）');
  assert(wxml.includes('bindtap="onOpenTypeSheet"') && wxml.includes('bindtap="onOpenTagSheet"'), '类型行与场合行点开平铺面板');
  assert(wxml.includes('tileSheet.show') && wxml.includes('tile-grid') && wxml.includes('tile-cell'), '平铺面板结构在（格子＋选中态）');
  assert(wxml.includes('bindtap="onTileConfirm"') && wxml.includes('bindtap="onTileCancel"'), '面板有确定与取消');
  assert(wxml.includes('pickerOpen') && wxml.includes('选择亲友'), '选亲友面板不动');
  assert(js.includes('tileSheet: { show: false'), '面板状态初值关闭');
  assert(js.includes('onOpenTypeSheet') && js.includes('onOpenTagSheet') && js.includes('onTilePick') && js.includes('onTileConfirm') && js.includes('onTileCancel'), '面板五处处理齐全');
  assert(!js.includes('onTypeChange(e)') && !js.includes('onTagChange(e)'), '旧轮盘处理已删');
  assert(wxss.includes('.tile-cell { width: calc(20% - 7px);'), '每排 5 格');
  assert(wxss.includes('.tile-cell.on { border-color: #F0575A; color: #F0575A; background: #FDE8E8; }'), '选中态红框红字＋淡粉底');
  assert(wxss.includes('.tile-confirm { color: #F0575A;') && wxss.includes('.tile-cancel { color: #999; }'), '确定红字取消灰字');
});

test('DF 送礼页共计：粉红渐变＋数字白字＋标签字深色', () => {
  const wxss = readMp('pages/gifts/gifts.wxss');
  assert(wxss.includes('background: linear-gradient(135deg, #FFC7C3, #F78C8F);'), '共计块改首页送礼粉红渐变（CT批米黄作废）');
  assert(wxss.includes('.total-line .red { color: #fff;'), '笔数和金额数字改白字');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px;') && wxss.includes('color: #333;'), '标签字仍深色、居中字号不动');
});

test('DF 收礼主页：礼薄名橙黄底块＋日期共几笔加深＋金额不动', () => {
  const wxss = readMp('pages/receive/receive.wxss');
  assert(wxss.includes('.nm { font-size: 16px; font-weight: 600; }'), '礼薄名改回只留 16px 加粗（DN批：DF 名块作废，渐变移到整行）');
  assert(wxss.includes('.dt { font-size: 12px; color: #666;'), '日期加深 #666');
  assert(wxss.includes('.cnt { color: #666; }'), '共几笔加深 #666');
  assert(wxss.includes('.amt { color: #1A1A1A; font-weight: 700; font-size: 14px; }'), '金额不动');
});
