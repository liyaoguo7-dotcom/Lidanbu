// 预览专用（2026-10-22 晚新版式）：三字名为主的数据集，验证
// ①姓名首字不动、末字底距贺礼 10px 均匀分布 ②金额整字不动、首字距贺礼 10px
// ③姓名/金额字号与贺礼同大（22），四种字体同一标准（本页示文楷整页＋毛笔体条）
const LC = require('/home/hatch/workspace/lidanbu/miniprogram/pages/landscape/landscape-core.js');
const theme = LC.THEMES.classic;

const creation = [
  ['张建国', 100000], ['李秀英', 50000], ['王志强', 150000], ['赵丽华', 200000],
  ['刘俊杰', 100000], ['陈玉兰', 300000], ['孙国强', 1000000], ['周美玲', 50000],
  ['吴文斌', 400000], ['郑春花', 500000], ['欧阳修远', 100000], ['欧阳', 200000],
];
const descList = creation.map(([name, amountFen], i) => ({
  id: `r${i + 1}`, name, amountFen, tagId: 'jiehun', createdAt: 1000 + i,
})).reverse();
const rows = LC.orderForBook(descList);
const built = LC.buildColumns(rows, { fontId: 'lxgw', midText: '贺礼' });
const builtMs = LC.buildColumns(rows.slice(0, 4), { fontId: 'mashanzheng', midText: '贺礼' });

const spec = LC.scaledSpec(844);
const stack = (fid) => LC.selectedStack(fid).replace(/"/g, "'");
const colHtml = (c, fid) => {
  if (c.empty) return `<div class="col" style="width:${spec.colW}px"></div>`;
  const chars = (arr, fontPx, family, color) => arr.map((ch) =>
    `<span class="vchar" style="top:${ch.top}px;font-size:${fontPx}px;font-family:${family};color:${color}">${ch.ch}</span>`).join('');
  return `<div class="col" style="width:${spec.colW}px">
    <div class="zone zone-name" style="top:${spec.nameTop}px;height:${spec.nameH}px">${chars(c.nameChars, c.nameFontSize, stack(fid), theme.inkColor)}</div>
    <div class="zone zone-mid" style="height:${spec.midH}px;margin-top:${spec.midShift}px">${chars(c.midChars, LC.SPEC.MID_FONT, LC.SONGTI_STACK.replace(/"/g, "'"), theme.midColor)}</div>
    <div class="zone zone-amt" style="bottom:${LC.SPEC.AMT_BOTTOM_PAD}px;height:${spec.amtH}px">${chars(c.amountChars, c.amountFontSize, stack(fid), theme.inkColor)}</div>
  </div>`;
};
const paper = (cols, fid) => `<div class="paper"><div class="track">${cols.map((c) => colHtml(c, fid)).join('')}</div></div>`;
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "LxgwWenKai"; src: url("../../../miniprogram/packages/fonts/lxgw-wenkai.woff2"); }
@font-face { font-family: "MaShanZheng"; src: url("../../../miniprogram/packages/fonts/mashanzheng.woff2"); }
@font-face { font-family: "LongCang"; src: url("../../../miniprogram/packages/fonts/longcang.woff2"); }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #888; }
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
.cap { width: 844px; color: #fff; font-size: 15px; padding: 8px 4px 0; font-family: sans-serif; }
</style></head><body>
<div class="frame"><div class="topbar"></div><div class="midrow"><div class="scroll"></div>${paper(built.columns, 'lxgw')}<div class="scroll"></div></div><div class="botbar"></div></div>
<div class="cap">下：马善政毛笔体（同标准，前 4 列）</div>
<div class="strip"><div class="scroll"></div>${paper(builtMs.columns.slice(0, 4), 'mashanzheng')}<div class="scroll"></div></div>
</body></html>`;
require('fs').writeFileSync('/home/hatch/workspace/lidanbu/docs/screens/landscape-fix-check/preview2.html', html);
console.log('preview2.html 已生成');
