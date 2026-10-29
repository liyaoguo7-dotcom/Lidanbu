/** CD批（用户定：顺序从左开始第一）：转正方向选错导致列序全反。
 * 真机证据：竖拍本核对页第 4 条周振海＝左起第 9 列＝右起第 4 列、第 5 条
 * 刘素琴＝左起第 8 列＝右起第 5 列，输出是整齐的右→左倒序；旧循环先试
 * 顺时针、比分高即采纳并 break，顺时针转竖拍图等于本子倒置，正向根本
 * 没试。修法：① 全部方向试完取最优；② 结构方向校验（姓名在标记带之
 * 下即倒置，转 180° 重识一次）。 */
const { test, assert } = require('./fw');
const tencentOcr = require('../cloudfunctions/api/tencent-ocr');
const jpeg = require('../cloudfunctions/api/node_modules/jpeg-js');

function makeWhiteJpegB64(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255; }
  data[0] = 0; data[1] = 0; data[2] = 0; // 左上角黑点做方向标记（纯白图顺/逆 90° 字节相同，无法区分方向）
  return Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data).toString('base64');
}
function det(text, x, y, w, h, conf) {
  return {
    DetectedText: text,
    Confidence: conf == null ? 90 : conf,
    Polygon: [
      { X: x, Y: y }, { X: x + w, Y: y },
      { X: x + w, Y: y + h }, { X: x, Y: y + h },
    ],
    ItemPolygon: null,
  };
}

test('CD 结构校验：正向不翻、倒置翻、横排同带不翻、无标记不翻', () => {
  // 正向：姓名上（y~100）、标记带中（y~500）、金额下（y~900）
  const upright = [
    det('张三', 100, 100, 40, 40), det('李四', 300, 100, 40, 40),
    det('贺礼', 100, 500, 40, 40), det('贺礼', 300, 500, 40, 40),
    det('伍佰元', 100, 900, 40, 40), det('壹仟元', 300, 900, 40, 40),
  ];
  assert.eq(tencentOcr.isUpsideDown(upright), false, '正向不翻');
  // 倒置：金额上、标记带中、姓名下
  const upside = [
    det('伍佰元', 100, 100, 40, 40), det('壹仟元', 300, 100, 40, 40),
    det('贺礼', 100, 500, 40, 40), det('贺礼', 300, 500, 40, 40),
    det('张三', 100, 900, 40, 40), det('李四', 300, 900, 40, 40),
  ];
  assert.eq(tencentOcr.isUpsideDown(upside), true, '倒置翻');
  // 横排同带：姓名与金额同行 y 相近，纵向差值小 → 不判断
  const horizontal = [
    det('张三', 100, 500, 40, 40), det('伍佰元', 200, 505, 40, 40),
    det('李四', 100, 600, 40, 40), det('壹仟元', 200, 605, 40, 40),
    det('贺礼', 400, 500, 40, 40), det('贺礼', 400, 600, 40, 40),
  ];
  assert.eq(tencentOcr.isUpsideDown(horizontal), false, '横排同带不翻');
  // 无标记带 → 不判断
  const noMarker = [
    det('张三', 100, 100, 40, 40), det('李四', 300, 100, 40, 40),
    det('伍佰元', 100, 900, 40, 40), det('壹仟元', 300, 900, 40, 40),
    det('王五', 500, 100, 40, 40), det('贰佰元', 500, 900, 40, 40),
  ];
  assert.eq(tencentOcr.isUpsideDown(noMarker), false, '无标记不翻');
});

const ENV = { TENCENT_SECRET_ID: 'AKIDcdtest00000000000000000000000', TENCENT_SECRET_KEY: 'cdtestsecretkey000000000000' };
const okResp = (dets) => ({ status: 200, json: { Response: { TextDetections: dets, RequestId: 'r1' } } });

test('CD 方案 A：全部方向试完取最优，顺时针高分不截胡逆时针更高分', async () => {
  const origB64 = makeWhiteJpegB64(64, 48);
  const cwB64 = tencentOcr.rotateJpegBase64(origB64, 'cw');
  const ccwB64 = tencentOcr.rotateJpegBase64(origB64, 'ccw');
  // 原图：6 个横长条、低分 → 触发转置怀疑（顺/逆 90°＋180°）
  const line = (name, amount, y, conf) => [
    det(name, 100, y, 120, 30, conf), det(amount, 300, y, 120, 30, conf),
  ];
  const orig = [...line('张三', '伍佰', 50, 30), ...line('李四', '伍佰', 150, 30), ...line('王五', '伍佰', 250, 30)];
  const cw = [...line('赵六', '伍佰', 50, 70), ...line('钱七', '伍佰', 150, 70), ...line('孙八', '伍佰', 250, 70)];
  const ccw = [...line('周九', '伍佰', 50, 95), ...line('吴良', '伍佰', 150, 95), ...line('郑浩', '伍佰', 250, 95)];
  const garbage = [];
  for (let i = 0; i < 8; i++) garbage.push(det('样元重行礼贺', 30, 40 + i * 70, 200, 62, 60));
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      const b64 = JSON.parse(req.body).ImageBase64;
      if (b64 === cwB64) return okResp(cw);
      if (b64 === ccwB64) return okResp(ccw);
      if (b64 === origB64) return okResp(orig);
      return okResp(garbage);
    },
  });
  const rows = await adapter.recognize('cloud://fake/cd-a.jpg', { imageBase64: origB64 });
  assert(rows.length >= 1, '应有行');
  assert.eq(rows[0].name, '周九', '最高分逆时针应胜出（旧逻辑会停在顺时针赵六）');
  assert.eq(rows.ocrTrace.rotated, 'ccw', '留痕应标 ccw');
});

test('CD 水印 guard：字母粘连的数字串不作金额，独立数字照常认', () => {
  const { findAllAmounts } = tencentOcr;
  assert.eq(JSON.stringify(findAllAmounts('xie25381').map((a) => a.yuan)), JSON.stringify([]), 'xie25381 不出金额');
  assert.eq(JSON.stringify(findAllAmounts('抖音号：xie25381').map((a) => a.yuan)), JSON.stringify([]), '抖音号水印不出金额');
  assert.eq(JSON.stringify(findAllAmounts('xie 25381').map((a) => a.yuan)), JSON.stringify([]), '隔空白粘连也不出金额');
  assert.eq(JSON.stringify(findAllAmounts('500').map((a) => a.yuan)), JSON.stringify([500]), '独立 500 照常认');
  assert.eq(JSON.stringify(findAllAmounts('小计 8800').map((a) => a.yuan)), JSON.stringify([8800]), '小计数字照常认');
  assert.eq(JSON.stringify(findAllAmounts('500 800').map((a) => a.yuan)), JSON.stringify([500, 800]), '两个独立数字都认');
  assert.eq(JSON.stringify(findAllAmounts('¥1000').map((a) => a.yuan)), JSON.stringify([1000]), '带 ¥ 照常认');
});

test('CD 方案 B：结构校验倒置即转 180° 重识一次（转正循环不介入）', async () => {
  const origB64 = makeWhiteJpegB64(64, 48);
  const r180B64 = tencentOcr.rotateJpegBase64(origB64, 'r180');
  // 原图直接出倒置结果：金额上、标记带中、姓名下；7 列、满分置信度，
  // 首轮分 ≥55 且非转置怀疑 → 转正循环不跑，r180 只能来自结构校验翻转
  const names = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九'];
  const amounts = ['伍佰元', '壹仟元', '伍佰元', '叁佰元', '伍佰元', '壹仟元', '伍佰元'];
  const upside = [];
  const upright = [];
  names.forEach((n, i) => {
    const x = 100 + i * 120;
    upside.push(det(amounts[i], x, 50, 40, 200, 100), det('贺礼', x, 300, 40, 40, 100), det(n, x, 550, 40, 200, 100));
    upright.push(det(n, x, 50, 40, 200, 100), det('贺礼', x, 300, 40, 40, 100), det(amounts[i], x, 550, 40, 200, 100));
  });
  let calls = 0;
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      calls += 1;
      const b64 = JSON.parse(req.body).ImageBase64;
      return okResp(b64 === r180B64 ? upright : upside);
    },
  });
  const rows = await adapter.recognize('cloud://fake/cd-b.jpg', { imageBase64: origB64 });
  assert.eq(calls, 4, '只调首轮双调＋翻转双调 4 次，转正循环不应介入');
  assert(rows.length >= 1, '重识后应有行');
  assert(rows.some((r) => String(r.name || '').replace(/□/g, '') === '张三'), '重识后应有正向姓名张三');
  assert(rows.ocrTrace.rotated && rows.ocrTrace.rotated.includes('r180'), '留痕应标 r180 翻转');
});
