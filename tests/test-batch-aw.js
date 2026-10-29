/**
 * AW批静态断言（2026-10-27，用户看 AV 预览后亲定）：
 * ① 卷轴对齐二次修正——五杆锚点改外侧横线 (52,783)、funeral 保持 AV 锚 (34,802)；
 * ② 纸面去掉左右竖线、以卷轴杆身为界（六样式共用 .paper 一处），上下横线与列间分隔保留；
 * ③ 金杆（cloud）帽子按参考图重绘为一件式轴头（draw-scrolls.py GOLD_CAP 同步改）。
 * 行为/数值断言在 test-batch-av-behavior.js（已按 AW 更新）；这里查数值落地与源码结构。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const wxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape/book.wxss'), 'utf8');
const draw = fs.readFileSync(path.join(__dirname, '..', 'tools/draw-scrolls.py'), 'utf8');

/* ① 锚点数值落地 */
const L = LC.SCROLL_GEOM.LINES;
for (const id of ['classic', 'blue', 'pear', 'bamboo', 'cloud']) {
  assert.strictEqual(L[id].top, 52, `AW ${id} 上锚应为外侧横线 52（上环带下缘）`);
  assert.strictEqual(L[id].bottom, 783, `AW ${id} 下锚应为外侧横线 783（下环带上缘）`);
}
assert.strictEqual(L.funeral.top, 34, 'AW funeral 上锚保持 AV 的 34 不动');
assert.strictEqual(L.funeral.bottom, 802, 'AW funeral 下锚保持 AV 的 802 不动');
assert.strictEqual(LC.SCROLL_GEOM.LINES_DEFAULT.top, 52, 'AW 缺省锚跟随五杆新锚 52');
assert.strictEqual(LC.SCROLL_GEOM.LINES_DEFAULT.bottom, 783, 'AW 缺省锚跟随五杆新锚 783');
// 新探出不超留白（基准画布：上 48 / 下 30；五杆 20.91/21.32、白事 13.02）
const lay = LC.scrollLayout(LC.SPEC.PAPER_H, 'classic');
assert.ok(lay.capBotPx < LC.SPEC.MARGIN_B, `AW 五杆下探出 ${lay.capBotPx} 应 < 下留白 30`);
assert.ok(lay.capTopPx < LC.SPEC.MARGIN_V, `AW 五杆上探出 ${lay.capTopPx} 应 < 上留白 48`);

/* ② 纸面边线：.paper 无左右边线、上下仍在；角花无竖段；列间分隔（.col border-left）保留 */
function cssBlock(selectorRe) {
  const m = wxss.match(selectorRe);
  assert.ok(m, `book.wxss 应能找到规则 ${selectorRe}`);
  return m[1];
}
const paper = cssBlock(/\.paper \{([^}]*)\}/);
assert.ok(/border-top:\s*2px solid/.test(paper), 'AW .paper 应保留上边线 2px');
assert.ok(/border-bottom:\s*2px solid/.test(paper), 'AW .paper 应保留下边线 2px');
assert.ok(!/border-left/.test(paper) && !/border-right/.test(paper),
  'AW .paper 不得再有左右边线（以杆身为界）');
assert.ok(!/border:\s*2px solid/.test(paper), 'AW .paper 不得再用四边 border 简写');
// CN批（用户 2026-10-29 定）：角花全部去掉，AW 的角花口径作废
for (const c of ['tl', 'tr', 'bl', 'br']) {
  assert.ok(!new RegExp(`\\.corner\\.${c} \\{`).test(wxss),
    `CN .corner.${c} 已删除（角花全部去掉）`);
}
const col = cssBlock(/\.col \{([^}]*)\}/);
assert.ok(/border-left:\s*2px solid/.test(col), 'AW .col 列间分隔线应保留（不在去线范围）');

/* ③ 金帽重绘：轮廓表与注释已是一件式轴头口径，旧多层口径不得残留 */
assert.ok(draw.includes('一件式车削轴头'), 'AW draw-scrolls.py GOLD_CAP 应为一件式车削轴头');
assert.ok(!draw.includes('宝塔帽：小球顶＋两层盘＋颈＋底环'), 'AW 旧金帽多层口径不得残留');

console.log('test-batch-aw: ok');
