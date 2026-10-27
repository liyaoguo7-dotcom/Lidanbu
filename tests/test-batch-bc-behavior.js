/**
 * BC批行为测试：横置真机四报修复——
 * ①卷轴不显示根因：book.wxml 模板需要的顶层数据 scrollBox 未在收礼/送礼
 *   两页的模板传参清单里（AT批加字段时漏传，真机槽位与图尺寸全为空）。
 *   本文件做「模板用到的顶层字段 ⊆ 两页传参清单」的完整性守门，防再漏。
 * ②列线铺满纸面：buildColumns 支持 minCols（页面按实际纸宽算），空本
 *   也要把空列补到铺满，右半边不再留无线空白。
 * ③缺字：回退链＝所选→补充字库 6 片→其余五款→楷/宋；子集外字能定位
 *   到补充片（虎/总实测）；api 白名单含 6 片文件。
 * ④切换：book.wxml 有就绪盖（!ready 时盖住整帧，不闪默认样式帧）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function templateTopLevelFields(wxml) {
  const used = new Set();
  for (const m of wxml.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
  return used;
}

test('BC模板传参完整性：book.wxml 用到的顶层字段两页都传齐（含 scrollBox）', () => {
  const book = read('miniprogram/pages/landscape/book.wxml');
  const used = templateTopLevelFields(book);
  // 循环局部变量与字面量不算页面数据
  for (const local of ['item', 'index', 'ch', 'true', 'false']) used.delete(local);
  assert(used.has('scrollBox'), 'book.wxml 确实用到 scrollBox（守门前提）');
  for (const pg of ['gift', 'receive']) {
    const page = read(`miniprogram/pages/landscape/${pg}/${pg}.wxml`);
    const m = page.match(/data="\{\{([^}]*)\}\}"/);
    assert(m, `${pg}.wxml 有模板传参清单`);
    const passed = new Set(m[1].split(',').map((x) => x.trim()));
    const missing = [...used].filter((f) => !passed.has(f));
    assert.eq(missing.join(','), '', `${pg} 漏传字段：${missing.join(',')}`);
  }
});

test('BC列线铺满：minCols 决定总列数、空列补到铺满', () => {
  const wide = LC.buildColumns([], { minCols: 20 });
  assert.eq(wide.totalGrid, 20, '空本按 minCols 铺满');
  assert.eq(wide.columns.length, 20, '列数组长度＝总列数');
  assert(wide.columns.every((c) => c.empty), '补出的都是空列');
  const few = LC.buildColumns([{ id: 'a', name: '张三', amountFen: 10000, tagId: 'jiehun' }], { minCols: 18 });
  assert.eq(few.totalGrid, 18, '有记录时同样铺满');
  assert.eq(few.emptyCount, 17, '空列数＝总列数－记录数');
  const many = LC.buildColumns(
    Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, name: '张三', amountFen: 100, tagId: 'jiehun' })),
    { minCols: 18 },
  );
  assert.eq(many.totalGrid, 25, '记录多于 minCols 时以记录数为准（滚动查看）');
  const legacy = LC.buildColumns([], {});
  assert.eq(legacy.totalGrid, 12, '不传 minCols 时保持旧口径 12 列下限');
});

test('BC回退链：所选字体→补充 6 片→其余五款→楷体→宋体', () => {
  const stack = LC.selectedStack('mashanzheng');
  const parts = stack.split(',').map((s) => s.trim());
  assert.eq(parts[0], '"MaShanZheng"', '链首是所选字体');
  for (let i = 1; i <= 6; i++) assert.eq(parts[i], `"LxgwWenKaiSupp${i}"`, `链第 ${i + 1} 位是补充片 ${i}`);
  const rest = parts.slice(7).join(',');
  for (const f of ['LxgwWenKai', 'LongCang', 'ZhiMangXing', 'CactusClassicalSerif', 'Bakudai']) {
    assert(rest.includes(`"${f}"`), `链含其余字体 ${f}`);
  }
  assert(rest.indexOf('KaiTi') > rest.indexOf('Bakudai'), '系统楷体排在自家字体之后');
  assert(rest.indexOf('Songti SC') > rest.indexOf('KaiTi'), '宋体在楷体之后（黑体永不出现）');
});

test('BC缺字定位：子集内字不需要补充、虎/总定位到正确片', () => {
  assert.eq(LC.suppChunksForText('张三李四').length, 0, '子集内姓名不触发补充加载');
  assert.eq(LC.suppChunksForText('').length, 0, '空文本不触发');
  assert.eq(LC.suppChunkIndexOf('总'), 1, '总（U+603B）落在第 2 片');
  assert.eq(LC.suppChunkIndexOf('虎'), 4, '虎（U+864E）落在第 5 片');
  const chunks = LC.suppChunksForText('王总与李虎');
  assert.eq(chunks.join(','), '0,1,4', '一页多字只取命中的片、去重升序（与也在 721 外→第 1 片）');
});

test('BC服务端白名单：补充字库 6 片可代取', () => {
  const api = read('cloudfunctions/api/index.js');
  for (let i = 1; i <= 6; i++) assert(api.includes(`'lxgw-supp${i}.ttf'`), `api 白名单含 lxgw-supp${i}.ttf`);
});

test('BC就绪盖：book.wxml 在 ready 前盖住整帧（不闪默认样式帧）', () => {
  const book = read('miniprogram/pages/landscape/book.wxml');
  assert(book.includes('wx:if="{{!ready}}" class="boot-cover"'), '模板含就绪盖');
  const wxss = read('miniprogram/pages/landscape/book.wxss');
  assert(/\.boot-cover\s*\{[^}]*position:\s*absolute/.test(wxss), '就绪盖为绝对定位覆膜');
});
