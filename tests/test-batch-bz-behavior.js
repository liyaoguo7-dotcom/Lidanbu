/** BZ批：四方向转正（180° 倒置照片也能智能转正）。
 * ① r180 像素落位：宽高不变、左上标记点落到右下、转两次回原位
 * ② 方向选择：转置怀疑 → 顺/逆 90°＋180°；非转置低分 → 只试 180°；好照片 → 不试
 * ③ 端到端：倒置照片（顺/逆 90° 都救不回）→ 180° 转正取优、留痕标 r180；好照片不多调 */
const { test, assert } = require('./fw');
const tencentOcr = require('../cloudfunctions/api/tencent-ocr');
const jpeg = require('../cloudfunctions/api/node_modules/jpeg-js');

function makeJpegB64(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 200; data[i * 4 + 1] = 30; data[i * 4 + 2] = 30; data[i * 4 + 3] = 255; }
  data[0] = 20; data[1] = 220; data[2] = 20; // 左上角绿点做方向标记
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

test('BZ r180：宽高不变、左上标记点落到右下、转两次回原位', async () => {
  const b64 = makeJpegB64(6, 4);
  const r180 = tencentOcr.rotateJpegBase64(b64, 'r180');
  assert(r180, '应能转 180°');
  const img = jpeg.decode(Buffer.from(r180, 'base64'), { useTArray: true });
  assert.eq(img.width, 6, 'r180 宽不变');
  assert.eq(img.height, 4, 'r180 高不变');
  const gi = (3 * img.width + 5) * 4; // 右下角
  assert(img.data[gi + 1] > 150 && img.data[gi] < 120, '绿点应落在右下角');
  const back = tencentOcr.rotateJpegBase64(r180, 'r180');
  const img2 = jpeg.decode(Buffer.from(back, 'base64'), { useTArray: true });
  assert.eq(img2.width, 6, '转两次宽复原');
  assert.eq(img2.height, 4, '转两次高复原');
  const gi2 = 0;
  assert(img2.data[gi2 + 1] > 150 && img2.data[gi2] < 120, '绿点应回到左上角');
  assert.eq(tencentOcr.rotateJpegBase64('not-a-jpeg', 'r180'), null, '非 JPEG 静默返回 null');
});

test('BZ 方向选择：转置怀疑含 180°；非转置低分只试 180°；好照片不试', async () => {
  assert.eq(JSON.stringify(tencentOcr.pickRotationDirs({ suspect: true, score: 30, rowsEmpty: false })), JSON.stringify(['cw', 'ccw', 'r180']), '转置怀疑 → 三个方向');
  assert.eq(JSON.stringify(tencentOcr.pickRotationDirs({ suspect: false, score: 30, rowsEmpty: false })), JSON.stringify(['r180']), '非转置低分 → 只试 180°');
  assert.eq(JSON.stringify(tencentOcr.pickRotationDirs({ suspect: false, score: 80, rowsEmpty: true })), JSON.stringify(['r180']), '无行也试 180°（兜底倒置）');
  assert.eq(JSON.stringify(tencentOcr.pickRotationDirs({ suspect: false, score: 80, rowsEmpty: false })), JSON.stringify([]), '好照片不试任何方向');
});

const ENV = { TENCENT_SECRET_ID: 'AKIDbztest00000000000000000000000', TENCENT_SECRET_KEY: 'bztestsecretkey000000000000' };
const okResp = (dets) => ({ status: 200, json: { Response: { TextDetections: dets, RequestId: 'r1' } } });

test('BZ 端到端：倒置照片 90° 救不回、180° 转正取优、留痕标 r180', async () => {
  const origB64 = makeJpegB64(64, 48);
  const cwB64 = tencentOcr.rotateJpegBase64(origB64, 'cw');
  const ccwB64 = tencentOcr.rotateJpegBase64(origB64, 'ccw');
  const r180B64 = tencentOcr.rotateJpegBase64(origB64, 'r180');
  const garbage = [];
  for (let i = 0; i < 8; i++) garbage.push(det('样元重行礼贺', 30, 40 + i * 70, 200, 62, 60));
  const clean = [det('張三壹仟元整', 200, 50, 42, 300, 95), det('李四伍佰元整', 320, 50, 42, 300, 94)];
  let calls = 0;
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      calls += 1;
      const b64 = JSON.parse(req.body).ImageBase64;
      // 只有 180° 转正后的图才认得出；原图与 90° 图都是垃圾
      return okResp(b64 === r180B64 ? clean : garbage);
    },
  });
  const rows = await adapter.recognize('cloud://fake/upside-down.jpg', { imageBase64: origB64 });
  assert(calls > 2, '倒置照片应多调转正轮次');
  assert.eq(rows.length, 2, '180° 转正后应认出两笔');
  assert.eq(rows.ocrTrace.rotated, 'r180', '留痕应标 r180');
  assert(cwB64 && ccwB64, '测试前置：90° 转图应生成成功');
});

test('BZ 端到端：好照片不多调（双调 2 次即止）', async () => {
  const origB64 = makeJpegB64(64, 48);
  const clean = [det('張三壹仟元整', 200, 50, 42, 300, 95), det('李四伍佰元整', 320, 50, 42, 300, 94)];
  let calls = 0;
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async () => { calls += 1; return okResp(clean); },
  });
  const rows = await adapter.recognize('cloud://fake/good.jpg', { imageBase64: origB64 });
  assert.eq(calls, 2, '好照片只调手写＋印刷 2 次，不试转正');
  assert.eq(rows.length, 2, '好照片直接认出两笔');
  assert(!rows.ocrTrace.rotated, '好照片留痕无 rotated');
});
