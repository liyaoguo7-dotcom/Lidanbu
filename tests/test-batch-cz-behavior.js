/** CZ批（用户 2026-10-29 定）：送礼页横置礼单本入口块底色改首页本月
 * 淡黄 #FBF3D9（取代 CT批拍照导入粉 #FDE8E8）；上下内边距 14px→10px、
 * 高度收短一点；文字、圆角、位置、与共计块的 10px 隙不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CZ 送礼页横置入口块（DR批：取共计最左再浅一号 #FFD2CF，淡黄已移到共计栏）＋高度收短一点', () => {
  const wxss = readMp('pages/gifts/gifts.wxss');
  assert(wxss.includes('.card.entry-row { margin-top: 0; margin-bottom: 0; background: #FFD2CF; }'), '横置块底色 DR批 #FFD2CF');
  assert(wxss.includes('.entry-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; }'), '横置块上下内边距 14px→10px');
  assert(wxss.includes('.entry-title { font-size: 15px; font-weight: 600; }'), '横置块文字不动');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px; padding: 8px 16px 6px;'), '共计块不动');
});
