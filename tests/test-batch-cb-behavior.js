/** CB批（用户 2026-10-29 定）：大写数字不会出现在人名中——人名遇大写
 * 数字即断（金额的开始）；大写数字串自动归为金额；人名上限由 4 字改 3 字。
 * 真机证据：竖版核对页第 1 条名“伍佰元四”、第 5 条名“王丽壹仟”、第 6 条
 * 名“刘增瑞伍”、第 8 条名“伍佰元”——金额串进了姓名栏。 */
const { test, assert } = require('./fw');
const tencentOcr = require('../cloudfunctions/api/tencent-ocr');
const { guardRowNames, stripCapitalFromName, parseWithGrid } = tencentOcr;

test('CB 隔断：人名遇大写数字即断', () => {
  assert.eq(stripCapitalFromName('王丽壹仟'), '王丽', '王丽壹仟→王丽');
  assert.eq(stripCapitalFromName('伍佰元四'), '', '伍佰元四全是金额→空名');
  assert.eq(stripCapitalFromName('刘增瑞伍'), '刘增瑞', '尾部残字伍也断');
  assert.eq(stripCapitalFromName('伍佰元'), '', '伍佰元→空名');
  assert.eq(stripCapitalFromName('赵秀云参'), '赵秀云', '参非姓、无名用，断');
  assert.eq(stripCapitalFromName('王丽吾佰'), '王丽', '吾后跟佰是金额语境→断');
});

test('CB 姓例外：陆/万作姓时不断', () => {
  assert.eq(stripCapitalFromName('陆小凤'), '陆小凤', '陆姓＋名不断');
  assert.eq(stripCapitalFromName('万明'), '万明', '万姓＋名不断');
  assert.eq(stripCapitalFromName('陆仟'), '', '陆后跟仟是金额→断为空');
  assert.eq(stripCapitalFromName('张陆仟'), '张', '张后陆仟是金额→断在陆前');
});

test('CB 上限 3 字：超长按姓位锚点截 3 字；隔断先于截断', () => {
  const rows = guardRowNames([
    { name: '王丽壹仟', amountFen: null },
    { name: '伍佰元四', amountFen: null },
    { name: '王小明明', amountFen: 100 },
    { name: '陆小凤', amountFen: 200 },
  ]);
  assert.eq(rows[0].name, '王丽', '王丽壹仟→王丽');
  assert.eq(rows[1].name, '', '伍佰元四→空名');
  assert.eq(rows[2].name, '王小明', '4 字名截 3 字');
  assert.eq(rows[3].name, '陆小凤', '陆姓 3 字名不动');
});

test('CB 金额已落袋：姓名里残留形近字一律断掉', () => {
  const rows = guardRowNames([
    { name: '刘增瑞他', amountFen: 50000 },
    { name: '王他', amountFen: null },
    { name: '王他', amountFen: 50000 },
  ]);
  assert.eq(rows[0].name, '刘增瑞', '金额已认出，他是残段→断');
  assert.eq(rows[1].name, '王他', '无金额时尾部形近字保留（宁缺毋滥，核对页可改）');
  assert.eq(rows[2].name, '王', '金额已认出，尾部形近字断');
});

test('CB 网格列模式：金额串不进姓名栏', () => {
  const grid = { columns: [{ x0: 0, x1: 100 }, { x0: 100, x1: 200 }], dividers: [0, 100, 200], medianGap: 100 };
  const det = (text, x, y, w, h) => ({
    DetectedText: text,
    Polygon: [{ X: x, Y: y }, { X: x + w, Y: y }, { X: x + w, Y: y + h }, { X: x, Y: y + h }],
  });
  // 王丽列：金额碎片拆成“壹”“仟”两段，标准路径只认仟作 1000，姓名残段“王丽壹”须隔断为王丽
  const dets = [
    det('王丽', 10, 10, 40, 20), det('壹', 10, 100, 20, 20), det('仟', 10, 130, 20, 20),
    det('刘素琴', 110, 10, 40, 20), det('伍佰', 110, 100, 30, 20),
  ];
  const r = parseWithGrid(dets, grid);
  assert(r.paired, '仍应配对');
  assert.eq(r.rows[0].name, '王丽', '王丽列姓名不含壹');
  assert.eq(r.rows[1].name, '刘素琴', '刘素琴列正常');
});
