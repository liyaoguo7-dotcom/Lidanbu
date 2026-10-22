// 中段词颜色加深对比图（任务AB 第 9 项）：传统经典 + 祥云金 两样式，改前 vs 改后同版式并排。
// 版式/列模型走仓库真实 landscape-core.buildColumns（COL_W 56、字号封顶 22）；
// 改前颜色为任务AB 前的 THEMES 值（classic/cloud 中段与墨色），改后为现行值。
// 纸面纹路瓦片略（纯色纸面），只比颜色。
const LC = require('/home/hatch/workspace/lidanbu/miniprogram/pages/landscape/landscape-core.js');

const BEFORE = {
  classic: { lineColor: '#B8322A', frameColor: '#B8322A', paperBg: '#FFF8F2', marginBg: '#F9E9DC', midColor: '#B8322A', inkColor: '#2B2B2B' },
  cloud: { lineColor: '#A67C2E', frameColor: '#A67C2E', paperBg: '#FDF8EC', marginBg: '#F5EAD0', midColor: '#A67C2E', inkColor: '#2B2B2B' },
};
const rows = [
  { id: 'r1', name: '张建国', amountFen: 100000, tagId: 'jiehun' },
  { id: 'r2', name: '李秀英', amountFen: 50000, tagId: 'jiehun' },
  { id: 'r3', name: '王志强', amountFen: 150000, tagId: 'jiehun' },
  { id: 'r4', name: '赵丽华', amountFen: 50000, tagId: 'jiehun' },
  { id: 'r5', name: '刘俊杰', amountFen: 100000, tagId: 'jiehun' },
  { id: 'r6', name: '陈玉兰', amountFen: 200000, tagId: 'jiehun' },
];
const spec = LC.scaledSpec(844);
const sel = LC.selectedStack('lxgw').replace(/"/g, "'");
const built = LC.buildColumns(rows, { fontId: 'lxgw', midText: '贺礼' });

function panel(theme, label) {
  const chars = (arr, fontPx, family, color) => arr.map((ch) =>
    `<span class="vchar" style="top:${ch.top}px;font-size:${fontPx}px;font-family:${family};color:${color}">${ch.ch}</span>`).join('');
  const cols = built.columns.slice(0, 6).map((c) => `<div class="col" style="width:${spec.colW}px;border-left-color:${theme.lineColor}">
    <div class="zone zone-name" style="top:${spec.innerPad}px;height:${spec.nameH}px">${chars(c.nameChars, c.nameFontSize, sel, theme.inkColor)}</div>
    <div class="zone zone-mid" style="height:${spec.midH}px">${chars(c.midChars, LC.SPEC.MID_FONT, LC.SONGTI_STACK.replace(/"/g, "'"), theme.midColor)}</div>
    <div class="zone zone-amt" style="bottom:${LC.SPEC.AMT_BOTTOM_PAD}px;height:${spec.amtH}px">${chars(c.amountChars, c.amountFontSize, sel, theme.inkColor)}</div>
  </div>`).join('');
  return `<div class="label">${label}</div><div class="frame" style="background:${theme.marginBg}">
    <div class="paper" style="border-color:${theme.frameColor};background:${theme.paperBg}"><div class="track">${cols}</div></div></div>`;
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "LxgwWenKai"; src: url("../../../miniprogram/packages/fonts/lxgw-wenkai.woff2"); }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #666; font-family: sans-serif; }
.label { width: 844px; color: #fff; font-size: 17px; padding: 8px 12px 4px; }
.frame { width: 844px; height: 330px; padding: 18px 46px; }
.paper { height: 294px; position: relative; border: 2px solid; overflow: hidden; }
.track { display: flex; flex-direction: row; height: 100%; }
.col { flex-shrink: 0; height: 100%; box-sizing: border-box; border-left: 1px solid; position: relative; }
.zone { position: absolute; left: 0; right: 0; }
.zone-mid { top: 50%; transform: translateY(-50%); }
.vchar { position: absolute; left: 50%; transform: translateX(-50%); line-height: 1; white-space: nowrap; }
</style></head><body>
${panel(BEFORE.classic, '传统经典 · 改前（中段 #B8322A，墨色 #2B2B2B）')}
${panel(LC.THEMES.classic, '传统经典 · 改后（中段 #9E2A22 深红，墨色 #262019 深褐黑）')}
${panel(BEFORE.cloud, '祥云金 · 改前（中段 #A67C2E，墨色 #2B2B2B）')}
${panel(LC.THEMES.cloud, '祥云金 · 改后（中段 #8A6520 深金，墨色 #262019 深褐黑）')}
</body></html>`;
require('fs').writeFileSync('/home/hatch/workspace/lidanbu/docs/screens/landscape-fix-check/midcompare.html', html);
console.log('midcompare.html 已生成');
