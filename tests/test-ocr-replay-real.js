/* BB批回归：真机留痕重放（夹具＝2026-10-27 控制台导出的真实碎片）。
 * 修复前：竖排判定失效走横排 → 21 条乱记录、金额全空。
 * 修复后（印刷份）：恰 12 条、左→右成列、金额 11/12 对
 * （末笔「伍」被引擎认作「他」，无数字可恢复 → 留空待核对页手填）。 */
const { assert, test } = require('./fw');
const ocr = require('../cloudfunctions/api/tencent-ocr');
const { REAL_PRINT } = require('./fixtures-ocr-real');

test('BB 真机重放：印刷份竖排解出 12 条、金额 11 对、无标记残渣', () => {
  const rows = ocr.parseDetections(REAL_PRINT);
  assert.eq(rows.length, 12);
  const amounts = rows.map((r) => r.amountFen);
  assert.eq(JSON.stringify(amounts), JSON.stringify([
    20000, 20000, 50000, 50000, 50000, 50000, 50000, 20000, 50000, 20000, 20000, null,
  ]));
  assert(rows[4].name === '陈志艳', '第 5 条应为陈志艳，实际 ' + rows[4].name);
  assert(rows[9].name === '李木生', '第 10 条应为李木生，实际 ' + rows[9].name);
  assert(rows[7].name.endsWith('二毛'), '第 8 条应以二毛结尾，实际 ' + rows[7].name);
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
