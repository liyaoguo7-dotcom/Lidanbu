/**
 * AT批静态断言：白事整本判定接线＋切样式重算中段词＋OCR 奠仪滤除＋卷轴贴合结构。
 * （node 原生 assert，run.js 尾部 require；行为断言在 test-batch-at-behavior.js）
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* AT-1 landscape-core 整本判定符号齐全 */
const lc = rd('miniprogram/pages/landscape/landscape-core.js');
for (const sym of ['FUNERAL_KEYWORDS', 'isFuneralBook', 'resolveBookMidText', 'resolveReceiveTheme2', 'SCROLL_GEOM', 'scrollLayout']) {
  assert.ok(lc.includes(sym), `AT landscape-core 应有 ${sym}`);
}
for (const kw of ['葬礼', '殡葬', '白事', '丧事', '丧礼', '追悼']) {
  assert.ok(lc.includes(`'${kw}'`), `AT 白事关键词应含「${kw}」`);
}
assert.ok(lc.includes('midTextForTag'), 'AT 逐列缺省 midTextForTag 保留');

/* AT-2/AT-3 book-common 接线：收礼整本判定、送礼样式覆盖、切样式重建列 */
const bc = rd('miniprogram/pages/landscape/book-common.js');
assert.ok(bc.includes("resolveReceiveTheme2({ tagId: ev.tagId, title: ev.name }"), 'AT-2 收礼主题应走整本判定（标签+标题）');
assert.ok(bc.includes("resolveBookMidText({ tagId: ev.tagId, title: ev.name, styleId: this.data.styleId })"), 'AT-2 收礼中段词应走整本判定');
assert.ok(bc.includes("resolveBookMidText({ styleId: this.data.styleId })"), 'AT-3 送礼中段词应按所选样式判定');
assert.ok(bc.includes("resolveReceiveTheme2({ tagId: this._event.tagId, title: this._event.name }"), 'AT-2 切样式主题应走整本判定');
const refresh = bc.slice(bc.indexOf('_refreshTheme()'));
assert.ok(refresh.slice(0, 900).includes('this.reload()'), 'AT-2/AT-3 切样式后应重建列重算中段词（_refreshTheme 调 reload）');
assert.ok(!bc.includes('LC.midTextForTag(ev.tagId)'), 'AT-2 收礼不得再用逐标签中段词');
assert.ok(!bc.includes('LC.resolveReceiveTheme(this._event.tagId'), 'AT-2 切样式不得再用旧签名判定');

/* AT-4 OCR 印刷字滤除扩到奠仪（繁简） */
const ocr = rd('cloudfunctions/api/tencent-ocr.js');
assert.ok(ocr.includes('賀禮|贺礼|奠儀|奠仪'), 'AT-4 竖排滤除正则应含奠儀|奠仪');

/* AT-6 卷轴贴合结构：槽位容器＋scrollBox 绑定＋绝对定位 */
const wxml = rd('miniprogram/pages/landscape/book.wxml');
assert.strictEqual((wxml.match(/scroll-box/g) || []).length, 2, 'AT-6 左右各一个卷轴槽位');
assert.ok(wxml.includes('scrollBox.slotW') && wxml.includes('scrollBox.imgW') && wxml.includes('scrollBox.imgH')
  && wxml.includes('scrollBox.top') && wxml.includes('scrollBox.left'), 'AT-6 卷轴尺寸/偏移应走 scrollBox 绑定');
assert.ok(!wxml.includes('spec.scrollW'), 'AT-6 卷轴不得再用 spec.scrollW 定宽');
const wxss = rd('miniprogram/pages/landscape/book.wxss');
assert.ok(/\.scroll-box\s*\{[^}]*position: relative/.test(wxss), 'AT-6 槽位应为定位容器');
assert.ok(/\.scroll-img\s*\{[^}]*position: absolute/.test(wxss), 'AT-6 整图应在槽内绝对定位');
assert.ok(bc.includes('LC.scrollLayout(paperHPx,'), 'AT-6 页面应按实际纸高算卷轴定位（AV 起带主题参数取分界线锚点）');
assert.ok(bc.includes('scrollBox.slotW'), 'AT-6 paperInnerW 应按新槽位宽扣减');

console.log('✓ AT批·接线静态断言全过');
