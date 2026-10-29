/** CN批（用户 2026-10-29 定）：横置礼单纸面四角的角花小横线全部去掉，
 * 六个样式共用 book 模板，一处删全生效；纸面上下横线、列间分隔、
 * 卷轴杆子不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CN 横置纸面角花全部去掉', () => {
  const wxml = readMp('pages/landscape/book.wxml');
  const wxss = readMp('pages/landscape/book.wxss');
  assert(!wxml.includes('class="corner'), '纸面四角视图已删除');
  assert(!wxss.includes('.corner'), '角花样式已删除');
  assert(wxss.includes('border-top: 2px solid; border-bottom: 2px solid;'), '纸面上下横线不动');
  assert(wxss.includes('border-left: 2px solid;'), '列间分隔线不动');
  assert(wxml.includes('<image class="scroll-img"') && wxml.includes('class="scroll-img flip"'), '两头卷轴杆子不动');
  assert(readMp('pages/landscape/gift/gift.wxml').includes('<import src="../book.wxml" />'), '送礼页同引 book 模板（六样式一处删全生效）');
  assert(readMp('pages/landscape/receive/receive.wxml').includes('<import src="../book.wxml" />'), '收礼页同引 book 模板');
});
