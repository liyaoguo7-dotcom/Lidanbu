/** 金额显示函数单元测试（检查点1修改意见第4条，高风险：金额） */
const { test, assert } = require('./fw');
const { formatAmount, formatAmountInt, parseAmountToFen } = require('../core/format');

// --- formatAmount：分 → "x.xx" ---
test('formatAmount: 0分 → "0.00"', () => {
  assert.eq(formatAmount(0), '0.00', 'zero');
});

test('formatAmount: 1分 → "0.01"', () => {
  assert.eq(formatAmount(1), '0.01', 'one fen');
});

test('formatAmount: 100000分 → "1000.00"', () => {
  assert.eq(formatAmount(100000), '1000.00', 'thousand');
});

test('formatAmount: 100050分 → "1000.50"（一位小数补零）', () => {
  assert.eq(formatAmount(100050), '1000.50', 'pad zero');
});

test('formatAmount: 100005分 → "1000.05"', () => {
  assert.eq(formatAmount(100005), '1000.05', 'cents');
});

test('formatAmount: 9999999900分 → "99999999.00"（大金额）', () => {
  assert.eq(formatAmount(9999999900), '99999999.00', 'big');
});

test('formatAmount: 负数 -100000分 → "-1000.00"', () => {
  assert.eq(formatAmount(-100000), '-1000.00', 'negative');
});

test('formatAmount: 非数字输入不抛错，返回 "0.00"', () => {
  assert.eq(formatAmount(NaN), '0.00', 'nan');
  assert.eq(formatAmount(undefined), '0.00', 'undefined');
  assert.eq(formatAmount('abc'), '0.00', 'string');
});

test('formatAmount: 小数分四舍五入到整分', () => {
  assert.eq(formatAmount(100000.4), '1000.00', 'round down');
  assert.eq(formatAmount(100000.5), '1000.01', 'round up');
});

// --- parseAmountToFen：输入 → 分，非法 → null ---
test('parseAmountToFen: "1000" → 100000', () => {
  assert.eq(parseAmountToFen('1000'), 100000, 'int');
});

test('parseAmountToFen: "1000.5" → 100050', () => {
  assert.eq(parseAmountToFen('1000.5'), 100050, 'one decimal');
});

test('parseAmountToFen: "1000.05" → 100005', () => {
  assert.eq(parseAmountToFen('1000.05'), 100005, 'two decimals');
});

test('parseAmountToFen: 前后空格自动去掉', () => {
  assert.eq(parseAmountToFen('  1000  '), 100000, 'trim');
});

test('parseAmountToFen: 三位小数/空/字母/负数/零 → null', () => {
  assert.eq(parseAmountToFen('1000.555'), null, '3 decimals');
  assert.eq(parseAmountToFen(''), null, 'empty');
  assert.eq(parseAmountToFen('abc'), null, 'alpha');
  assert.eq(parseAmountToFen('-5'), null, 'negative');
  assert.eq(parseAmountToFen('0'), null, 'zero');
  assert.eq(parseAmountToFen(null), null, 'null');
});

test('parseAmountToFen 与 formatAmount 往返一致', () => {
  const cases = ['1', '10.5', '1000', '1000.05', '99999999'];
  for (const s of cases) {
    const fen = parseAmountToFen(s);
    assert.eq(formatAmount(fen), parseFloat(s).toFixed(2), 'roundtrip ' + s);
  }
});

// --- formatAmountInt：整元去尾、带分保留两位（用户 2026-10-20 修订：带零头不四舍五入）---
test('formatAmountInt: 整元 886600分 → "8866"（去尾 .00）', () => {
  assert.eq(formatAmountInt(886600), '8866', 'whole yuan strips .00');
});

test('formatAmountInt: 带零头 1250分 → "12.50"（保留两位，不四舍五入）', () => {
  assert.eq(formatAmountInt(1250), '12.50', 'cents kept');
});

test('formatAmountInt: 100005分 → "1000.05"（零头原样保留）', () => {
  assert.eq(formatAmountInt(100005), '1000.05', 'no rounding');
});

test('formatAmountInt: 100050分 → "1000.50"（不进位）', () => {
  assert.eq(formatAmountInt(100050), '1000.50', 'no round up');
});

test('formatAmountInt: 0分 → "0"', () => {
  assert.eq(formatAmountInt(0), '0', 'zero');
});

test('formatAmountInt: 负数带零头 -1250分 → "-12.50"', () => {
  assert.eq(formatAmountInt(-1250), '-12.50', 'negative with cents');
});

test('formatAmountInt: 非数字输入不抛错，返回 "0"', () => {
  assert.eq(formatAmountInt(NaN), '0', 'nan');
  assert.eq(formatAmountInt(undefined), '0', 'undefined');
  assert.eq(formatAmountInt('abc'), '0', 'string');
});
