/* BB批回归：真机留痕重放（夹具＝2026-10-27 控制台导出的真实碎片）。
 * BB 修复后（印刷份）：恰 12 条、左→右成列、金额 11/12 对。
 * BH批再进一步（同夹具）：7/8 两条列序归正（旧期望里两条金额互换、
 * 是 xMin 被跨列宽框拖偏的轮转）；末笔「伍」被认作「他」由救援表
 * 他→5 救回 → 金额 12/12 全对。 */
const { assert, test } = require('./fw');
const ocr = require('../cloudfunctions/api/tencent-ocr');
const { REAL_PRINT } = require('./fixtures-ocr-real');

test('BB/BH 真机重放：印刷份竖排解出 12 条、金额 12 对、无标记残渣', () => {
  const rows = ocr.parseDetections(REAL_PRINT);
  assert.eq(rows.length, 12);
  const amounts = rows.map((r) => r.amountFen);
  assert.eq(JSON.stringify(amounts), JSON.stringify([
    20000, 20000, 50000, 50000, 50000, 50000, 20000, 50000, 50000, 20000, 20000, 50000,
  ]));
  assert(rows[4].name === '陈志艳', '第 5 条应为陈志艳，实际 ' + rows[4].name);
  assert(rows[9].name === '李木生', '第 10 条应为李木生，实际 ' + rows[9].name);
  assert(rows[6].name.endsWith('二毛'), '第 7 条应以二毛结尾（BH 列序归正；旧断言写在轮转位上），实际 ' + rows[6].name);
  for (const r of rows) {
    assert(!/[贺礼]/.test(r.name.slice(1)), '姓名不应含贺礼残渣：' + r.name);
  }
});

test('BB 竖排金额救援：系统性误读可解码、高阶金额不乱救', () => {
  assert.eq(ocr.decodeVerticalAmountTail('张三式伯元').amountFen, 20000);
  assert.eq(ocr.decodeVerticalAmountTail('李四伍m').amountFen, 50000);
  assert.eq(ocr.decodeVerticalAmountTail('王五伍元').amountFen, 50000);
  assert(ocr.decodeVerticalAmountTail('赵六壹仟元') === null, '含仟不应救援');
  assert(ocr.decodeVerticalAmountTail('孙七') === null, '无金额尾不应救援');
});
