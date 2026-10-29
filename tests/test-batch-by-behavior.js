/** BY批：列模式（用户定：红线分列＋数数配对，花纹图案忽略）。
 * 1 红线网格检测：合成红线表格图（白底＋红竖线＋黑字迹＋边角花纹＋浅粉图案）→ 分界线位置对、列数对；
 * 2 数数配对：金额中心漂移到邻列时仍按序号配对正确；
 * 3 数量对不上时回落列内配对并记录 mismatch；
 * 4 无网格图 → null，回落现有流程（不抛错）。
 */
const { test, assert } = require('./fw');
const jpeg = require('../cloudfunctions/api/node_modules/jpeg-js');
const { detectGridFromJpeg, parseWithGrid } = require('../cloudfunctions/api/tencent-ocr');

function det(text, x, y, w, h) {
  return { DetectedText: text, Polygon: [{ X: x, Y: y }, { X: x + w, Y: y }, { X: x + w, Y: y + h }, { X: x, Y: y + h }] };
}

function synthGrid() {
  const W = 1200, H = 800;
  const data = Buffer.alloc(W * H * 4, 255);
  const px = (x, y, r, g, b) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(x, y, r, g, b);
  };
  // 红竖线：x=100..1100，步进 100（11 线 → 10 列），线宽 3px
  for (let x = 100; x <= 1100; x += 100) rect(x, 20, x + 3, 780, 200, 30, 30);
  // 黑字迹（每列一小块，模拟姓名/金额）
  for (let c = 0; c < 10; c++) {
    rect(120 + c * 100, 100, 170 + c * 100, 130, 30, 30, 30);
    rect(120 + c * 100, 600, 170 + c * 100, 630, 30, 30, 30);
  }
  // 边角花纹：左上角强红块（局部，不成行）——应被忽略，不产生假分界线
  rect(130, 0, 190, 60, 200, 30, 30);
  // 浅粉图案（爱心类）：进不了强红阈值
  rect(500, 300, 560, 360, 245, 200, 205);
  const enc = jpeg.encode({ data, width: W, height: H }, 85);
  return Buffer.from(enc.data).toString('base64');
}

test('BY 红线网格检测：合成表格图分界线位置对、列数对、花纹不生假线', () => {
  const grid = detectGridFromJpeg(synthGrid());
  assert(grid, '合成表格图应检出网格');
  assert.eq(grid.columns.length, 10, '11 线 → 10 列');
  const expected = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
  for (let i = 0; i < expected.length; i++) {
    assert(Math.abs(grid.dividers[i] - expected[i]) <= 15, `分界线 ${i} 在 ${expected[i]}±15 内，实际 ${grid.dividers[i]}`);
  }
});

test('BY 宽段拆分：中间一条分界线被花纹盖住时按中位间距补线', () => {
  const W = 1200, H = 800;
  const data = Buffer.alloc(W * H * 4, 255);
  const px = (x, y, r, g, b) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(x, y, r, g, b);
  };
  // 故意缺 x=300 一条线（模拟被花纹盖住），其余与合成表格图相同
  for (let x = 100; x <= 1100; x += 100) {
    if (x === 300) continue;
    rect(x, 20, x + 3, 780, 200, 30, 30);
  }
  const enc = jpeg.encode({ data, width: W, height: H }, 85);
  const grid = detectGridFromJpeg(Buffer.from(enc.data).toString('base64'));
  assert(grid, '缺一条线仍应检出网格');
  assert.eq(grid.columns.length, 10, '补线后恢复 10 列');
  assert(grid.dividers.some((d) => Math.abs(d - 300) <= 15), '补线位置在 300±15 内');
});

test('BY 无网格图：纯白图与乱涂图均返回 null（回落现有流程）', () => {
  const W = 800, H = 600;
  const white = Buffer.alloc(W * H * 4, 255);
  const encW = jpeg.encode({ data: white, width: W, height: H }, 85);
  assert.eq(detectGridFromJpeg(Buffer.from(encW.data).toString('base64')), null, '纯白图无网格');
  const scribble = Buffer.alloc(W * H * 4, 255);
  for (let y = 100; y < 120; y++) for (let x = 100; x < 500; x++) {
    const i = (y * W + x) * 4;
    scribble[i] = 30; scribble[i + 1] = 30; scribble[i + 2] = 30; scribble[i + 3] = 255;
  }
  const encS = jpeg.encode({ data: scribble, width: W, height: H }, 85);
  assert.eq(detectGridFromJpeg(Buffer.from(encS.data).toString('base64')), null, '无红线乱涂无网格');
});

test('BY 数数配对：金额中心漂移到邻列时仍按序号配对正确', () => {
  // 网格：3 列（0-100，100-200，200-300）；第 1 列的金额中心漂到第 2 列内
  const grid = { columns: [{ x0: 0, x1: 100 }, { x0: 100, x1: 200 }, { x0: 200, x1: 300 }], dividers: [0, 100, 200, 300], medianGap: 100 };
  const dets = [
    det('张三', 10, 10, 40, 20), det('500', 110, 100, 30, 20), // 金额本属第 1 列，中心 125 落入第 2 列
    det('李四', 110, 10, 40, 20), det('800', 210, 100, 30, 20),
    det('王五', 210, 10, 40, 20), det('1000', 310, 100, 40, 20), // 第 3 列金额中心 330 出右缘，算入末列
  ];
  const r = parseWithGrid(dets, grid);
  assert(r.paired, '数量相等应数数配对');
  assert.eq(r.rows.length, 3, '3 行');
  assert.eq(r.rows[0].name, '张三', '第 1 名');
  assert.eq(r.rows[0].amountFen, 50000, '第 1 金额 500 元（漂移仍配对）');
  assert.eq(r.rows[1].name, '李四', '第 2 名');
  assert.eq(r.rows[1].amountFen, 80000, '第 2 金额 800 元');
  assert.eq(r.rows[2].name, '王五', '第 3 名');
  assert.eq(r.rows[2].amountFen, 100000, '第 3 金额 1000 元');
});

test('BY 数量对不上：回落列内配对并记录 mismatch（不硬配、不丢行）', () => {
  const grid = { columns: [{ x0: 0, x1: 100 }, { x0: 100, x1: 200 }, { x0: 200, x1: 300 }], dividers: [0, 100, 200, 300], medianGap: 100 };
  const dets = [
    det('张三', 10, 10, 40, 20), det('500', 10, 100, 30, 20),
    det('李四', 110, 10, 40, 20), // 第 2 列只有姓名、无金额
    det('王五', 210, 10, 40, 20), det('1000', 210, 100, 40, 20),
  ];
  const r = parseWithGrid(dets, grid);
  assert(!r.paired, '数量不等不数数配对');
  assert(r.mismatch && r.mismatch.names === 3 && r.mismatch.amounts === 2, 'mismatch 记录 3 名 2 金额');
  assert(r.rows.length >= 2, '回落结果仍有行（不丢行）');
});

test('BY 网格列内贺礼印刷字不进姓名', () => {
  const grid = { columns: [{ x0: 0, x1: 100 }, { x0: 100, x1: 200 }], dividers: [0, 100, 200], medianGap: 100 };
  const dets = [
    det('张三', 10, 10, 40, 20), det('贺礼', 10, 50, 40, 20), det('500', 10, 100, 30, 20),
    det('李四', 110, 10, 40, 20), det('贺礼', 110, 50, 40, 20), det('800', 110, 100, 30, 20),
  ];
  const r = parseWithGrid(dets, grid);
  assert(r.paired, '贺礼剔除后数量相等应配对');
  assert.eq(r.rows[0].name, '张三', '姓名不含贺礼');
  assert.eq(r.rows[1].name, '李四', '姓名不含贺礼');
});
