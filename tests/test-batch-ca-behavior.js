/** CA批：大写金额猜读（用户定：大写数字就那几个，可以猜；没写“整”也要认）。
 * ① 形近误读串可猜回真金额（伍→吾/午/他、贰→式、陆→睦、柒→漆、佰→伯）
 * ② 无“整”字照常认（伍佰、壹仟本就该认，回归）
 * ③ 猜读不污染姓名：单字形近字、无数字的伯不成金额 */
const { test, assert } = require('./fw');
const { findAllAmounts, parseWithGrid } = require('../cloudfunctions/api/tencent-ocr');

const fen = (text) => findAllAmounts(text).map((a) => a.yuan * 100);

test('CA 猜读：大写金额形近误读串可猜回', () => {
  assert.eq(JSON.stringify(fen('吾佰')), JSON.stringify([50000]), '吾佰→500元');
  assert.eq(JSON.stringify(fen('午佰')), JSON.stringify([50000]), '午佰→500元');
  assert.eq(JSON.stringify(fen('他佰')), JSON.stringify([50000]), '他佰→500元');
  assert.eq(JSON.stringify(fen('式佰')), JSON.stringify([20000]), '式佰→200元');
  assert.eq(JSON.stringify(fen('睦仟')), JSON.stringify([600000]), '睦仟→6000元');
  assert.eq(JSON.stringify(fen('漆佰')), JSON.stringify([70000]), '漆佰→700元');
  assert.eq(JSON.stringify(fen('伍伯')), JSON.stringify([50000]), '伍伯→500元（伯有数字佐证才当佰）');
});

test('CA 无整字：干净大写金额照常认', () => {
  assert.eq(JSON.stringify(fen('伍佰')), JSON.stringify([50000]), '伍佰无整→500元');
  assert.eq(JSON.stringify(fen('壹仟')), JSON.stringify([100000]), '壹仟无整→1000元');
  assert.eq(JSON.stringify(fen('伍佰元整')), JSON.stringify([50000]), '伍佰元整→500元（回归）');
});

test('CA 猜读不污染姓名：单字形近字、无数字的伯不成金额', () => {
  assert.eq(JSON.stringify(fen('刘伯')), JSON.stringify([]), '刘伯无数字→无金额');
  assert.eq(JSON.stringify(fen('张午')), JSON.stringify([]), '张午单字无单位→无金额');
  assert.eq(JSON.stringify(fen('李吾')), JSON.stringify([]), '李吾单字无单位→无金额');
});

test('CA 网格列模式：误读金额也能配对', () => {
  const grid = { columns: [{ x0: 0, x1: 100 }, { x0: 100, x1: 200 }], dividers: [0, 100, 200], medianGap: 100 };
  const det = (text, x, y, w, h) => ({
    DetectedText: text,
    Polygon: [{ X: x, Y: y }, { X: x + w, Y: y }, { X: x + w, Y: y + h }, { X: x, Y: y + h }],
  });
  const dets = [
    det('周振海', 10, 10, 40, 20), det('吾佰', 10, 100, 30, 20),
    det('刘素琴', 110, 10, 40, 20), det('伍伯', 110, 100, 30, 20),
  ];
  const r = parseWithGrid(dets, grid);
  assert(r.paired, '误读金额也应配对');
  assert.eq(r.rows[0].amountFen, 50000, '周振海金额 500 元');
  assert.eq(r.rows[1].amountFen, 50000, '刘素琴金额 500 元');
});
