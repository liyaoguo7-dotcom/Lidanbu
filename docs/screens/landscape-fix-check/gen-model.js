// 生成横置列模型复刻页：数据走仓库真实 landscape-core.buildColumns + orderForBook，
// 版式 CSS 与 miniprogram/pages/landscape/book.wxss 任务AA 版逐条对应（基准画布 844×390，scale=1）。
const LC = require('/home/hatch/workspace/lidanbu/miniprogram/pages/landscape/landscape-core.js');
const theme = LC.THEMES.classic;

// 张三的婚礼 12 笔（记账先后＝创建序）；故意先按列表口径倒序（最新在前）喂入，再用 orderForBook 翻正
const creation = [
  ['张三', 100000], ['李四', 50000], ['王五', 50000], ['赵六', 200000],
  ['刘七', 100000], ['陈八', 300000], ['孙九', 100000], ['周十', 1000000],
  ['吴小明', 50000], ['郑文杰', 400000], ['欧阳修远', 100000], ['欧阳', 200000],
];
const descList = creation.map(([name, amountFen], i) => ({
  id: `r${i + 1}`, name, amountFen, tagId: 'jiehun', createdAt: 1000 + i, // createdAt 升序＝记账序
})).reverse(); // 列表口径：最新在前
const rows = LC.orderForBook(descList);
const built = LC.buildColumns(rows, { fontId: 'lxgw', midText: '贺礼' });
console.log('第一列姓名:', built.columns[0].name, '| 最后一列姓名:', built.columns[11].name);
if (built.columns[0].name !== '张三' || built.columns[11].name !== '欧阳') { console.error('列序断言失败'); process.exit(1); }

// 锚定校验列：3 字（壹元整）/4 字（壹仟元整）/6 字（壹仟伍佰元整）金额各一列
const anchor = LC.buildColumns([
  { id: 'a1', name: '张三', amountFen: 100, tagId: 'jiehun' },
  { id: 'a2', name: '李四', amountFen: 100000, tagId: 'jiehun' },
  { id: 'a3', name: '王五', amountFen: 150000, tagId: 'jiehun' },
], { fontId: 'lxgw', midText: '贺礼' });

const spec = LC.scaledSpec(844);
const sel = LC.selectedStack('lxgw').replace(/"/g, "'");
const colHtml = (c) => {
  if (c.empty) return `<div class="col" style="width:${spec.colW}px"></div>`;
  const chars = (arr, fontPx, family, color) => arr.map((ch) =>
    `<span class="vchar" style="top:${ch.top}px;font-size:${fontPx}px;font-family:${family};color:${color}">${ch.ch}</span>`).join('');
  return `<div class="col" style="width:${spec.colW}px">
    <div class="zone zone-name" style="top:${spec.nameTop}px;height:${spec.nameH}px">${chars(c.nameChars, c.nameFontSize, sel, theme.inkColor)}</div>
    <div class="zone zone-mid" style="height:${spec.midH}px;margin-top:${spec.midShift}px">${chars(c.midChars, LC.SPEC.MID_FONT, LC.SONGTI_STACK.replace(/"/g, "'"), theme.midColor)}</div>
    <div class="zone zone-amt" style="bottom:${LC.SPEC.AMT_BOTTOM_PAD}px;height:${spec.amtH}px">${chars(c.amountChars, c.amountFontSize, sel, theme.inkColor)}</div>
  </div>`;
};
const paper = (cols) => `<div class="paper"><div class="track">${cols.map(colHtml).join('')}</div></div>`;
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "LxgwWenKai"; src: url("../../../miniprogram/packages/fonts/lxgw-wenkai.woff2"); }
@font-face { font-family: "MaShanZheng"; src: url("../../../miniprogram/packages/fonts/mashanzheng.woff2"); }
@font-face { font-family: "LongCang"; src: url("../../../miniprogram/packages/fonts/longcang.woff2"); }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #888; }
/* frame/midrow/paper/col/zone/vchar 与 book.wxss 同构（基准画布） */
.frame { width: 844px; height: 390px; background: ${theme.marginBg}; display: flex; flex-direction: column; }
.topbar { height: 48px; flex-shrink: 0; }
.botbar { height: 48px; flex-shrink: 0; }
.midrow { flex: 1; display: flex; flex-direction: row; align-items: stretch; min-height: 0; }
.scroll { width: 32px; flex-shrink: 0; background: #E8CFC0; }
.paper { flex: 1; position: relative; border: 2px solid ${theme.frameColor}; background: ${theme.paperBg}; overflow: hidden; }
.track { display: flex; flex-direction: row; height: 100%; }
.col { flex-shrink: 0; height: 100%; box-sizing: border-box; border-left: 2px solid ${theme.lineColor}; position: relative; }
.zone { position: absolute; left: 0; right: 0; }
.zone-mid { top: 50%; transform: translateY(-50%); margin-top: -3px; }
.vchar { position: absolute; left: 50%; transform: translateX(-50%); line-height: 1; white-space: nowrap; }
.strip { margin-top: 20px; width: 844px; display: flex; }
.strip .paper { height: 294px; flex: 1; }
</style></head><body>
<div class="frame"><div class="topbar"></div><div class="midrow"><div class="scroll"></div>${paper(built.columns)}<div class="scroll"></div></div><div class="botbar"></div></div>
<div class="strip"><div class="scroll"></div>${paper(anchor.columns.slice(0, 3))}<div class="scroll"></div></div>
</body></html>`;
require('fs').writeFileSync('/home/hatch/workspace/lidanbu/docs/screens/landscape-fix-check/model.html', html);
console.log('model.html 已生成');
