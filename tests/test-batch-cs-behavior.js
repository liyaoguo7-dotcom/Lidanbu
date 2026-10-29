/** CS批（用户 2026-10-29 定）：往来页也改成左送礼、右收礼（与首页
 * 两大卡左右一致）。两块位置对换，颜色跟角色走（送礼粉红、收礼橙黄），
 * 故对换后往来左右浓淡顺序与首页一致（左淡右浓），CP批的“左右相反”
 * 备注就此作废；方块大小、间距、圆角、文字、合计卡都不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CS 往来左送礼右收礼、颜色跟角色', () => {
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  const wxss = readMp('pages/wanglai/wanglai.wxss');
  const idx = readMp('pages/index/index.wxss');
  const cmp = wxml.slice(wxml.indexOf('<view class="compare">'), wxml.indexOf('summary-card'));
  const first = cmp.indexOf('side-label');
  assert(cmp.indexOf('>送礼<') < cmp.indexOf('>收礼<'), '第一块送礼、第二块收礼');
  assert(cmp.indexOf('{{giftTotalText}}') < cmp.indexOf('{{receiveTotalText}}'), '送礼金额跟送礼块、收礼金额跟收礼块');
  assert(wxss.includes('.side:first-child { background: linear-gradient(135deg, #FFC7C3, #F78C8F); }'), '左块＝首页送礼淡粉渐变');
  assert(wxss.includes('.side:last-child { background: linear-gradient(135deg, #FFE4B8, #FDBE68); }'), '右块＝首页收礼浓橙渐变');
  assert(idx.includes('.bigcard.gift {\n  background: linear-gradient(135deg, #FFC7C3, #F78C8F);'), '首页左送礼淡粉（对照）');
  assert(idx.includes('.bigcard.receive {\n  background: linear-gradient(135deg, #FFE4B8, #FDBE68);'), '首页右收礼浓橙（对照）');
  const compare = wxss.slice(wxss.indexOf('.compare {'), wxss.indexOf('.summary-card {'));
  assert(compare.includes('gap: 12px;'), '方块间距不动');
  assert(!cmp.includes('bindtap'), '两块仍为纯展示（无点按，原样）');
});
