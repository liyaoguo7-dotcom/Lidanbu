'use strict';
/* BK批行为测试：解析拼装修复（2026-10-27 真机留痕驱动）
 * ① 分列防粘连：手写竖条碎片又高又黏时，聚类阈值被列距封顶，相邻列不链成一列
 * ② 模板印刷物剔除：跨 ≥3 列同高同文的碎片（花纹「望木」）不进姓名
 * ③ 姓名 4 字硬顶：超长名按姓位锚点截回 ≤4 字（用户定的姓名长度规律）
 * ④ 双金额证据并行：一笔的金额残段（无姓名用字）并回本行，不拆出幽灵行 */
const { test, assert } = require('./fw');
const tencentOcr = require('../cloudfunctions/api/tencent-ocr');

function frag(text, x, y, w, h) {
  return { text, x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}
function det(text, x, y, w, h) {
  return {
    DetectedText: text,
    Confidence: 90,
    Polygon: [
      { X: x, Y: y }, { X: x + w, Y: y },
      { X: x + w, Y: y + h }, { X: x, Y: y + h },
    ],
    ItemPolygon: null,
  };
}

test('BK 分列防粘连：高竖条两列（列距60<旧阈值88）必须分出 2 列', async () => {
  const frags = [
    frag('天持盼', 20, 49, 47, 189), frag('住佰无', 23, 387, 44, 154), frag('500', 25, 543, 40, 30),
    frag('李', 95, 32, 50, 199), frag('须', 98, 381, 46, 157), frag('800', 100, 546, 40, 29),
  ];
  const cols = tencentOcr.clusterByCentroid(frags);
  assert.eq(cols.length, 2, '相邻两列不得链成一列');
});

test('BK 印刷物剔除：望木在 3 列同高出现 → 剔除；仅 2 列出现 → 保留', async () => {
  const mk = (n) => {
    const frags = [];
    const cols = [];
    for (let i = 0; i < n; i++) {
      const name = frag(`名${i}`, i * 66 + 10, 40, 46, 180);
      const orn = frag('望木', i * 66 + 12, 254, 44, 112);
      cols.push({ list: [name, orn] });
      frags.push(name, orn);
    }
    return { frags, cols };
  };
  const three = mk(3);
  const out3 = tencentOcr.dropRepeatedPrintFrags(three.frags, three.cols);
  assert(!out3.some((f) => f.text === '望木'), '三列同高同文应判印刷物剔除');
  assert.eq(out3.length, 3, '各列姓名碎片保留');
  const two = mk(2);
  const out2 = tencentOcr.dropRepeatedPrintFrags(two.frags, two.cols);
  assert.eq(out2.length, 4, '仅两列重复不动');
});

test('BK 姓名硬顶：超 3 字按姓位锚点截断；正常名不动（CB批 4→3）', async () => {
  const rows = tencentOcr.guardRowNames([
    { name: '杂讯张三丰多', amountFen: 100 },
    { name: '天持盼望木住', amountFen: 200 },
    { name: '陈志艳', amountFen: 300 },
  ]);
  assert.eq(rows[0].name, '张三丰', '从第一个真姓起截 3 字');
  assert(rows[1].name.length <= 3, '无姓位锚点时截前 3 字');
  assert.eq(rows[2].name, '陈志艳', '3 字名不动');
});

test('BK 双金额证据：一笔不拆两行（大写条残段并回、金额取底部数字）', async () => {
  const rows = tencentOcr.parseDetections([
    det('张三', 100, 40, 50, 120),
    det('伍佰无', 100, 300, 50, 110),
    det('500', 100, 480, 50, 30),
  ]);
  assert.eq(rows.length, 1, '一列一笔不得拆成两行');
  assert.eq(rows[0].name, '张三', '姓名取顶部名条');
  assert.eq(rows[0].amountFen, 50000, '金额以底部数字为准');
});
