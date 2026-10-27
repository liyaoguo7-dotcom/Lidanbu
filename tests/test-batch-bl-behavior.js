'use strict';
/* BL批行为测试：照片转正（横置礼单竖着拍 → 云端自动转正重识）
 * ① JPEG 转正函数：宽高互换、像素落位正确、转两次方向互逆
 * ② 转置检测：横长条碎片＋低分才怀疑；竖条/高分不触发
 * ③ 端到端：首轮转置垃圾 → 转正重识取优、留痕标 rotated；正常照片不触发 */
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

test('BL 转正函数：宽高互换、标记像素按顺时针落到右上、逆时针回原位', async () => {
  const b64 = makeJpegB64(6, 4);
  const cw = tencentOcr.rotateJpegBase64(b64, 'cw');
  assert(cw, '应能转正');
  const img = jpeg.decode(Buffer.from(cw, 'base64'), { useTArray: true });
  assert.eq(img.width, 4, '转后宽=原高');
  assert.eq(img.height, 6, '转后高=原宽');
  /* 原左上绿点顺时针转后应到右上（x=3,y=0） */
  const gi = (0 * img.width + 3) * 4;
  assert(img.data[gi + 1] > 150 && img.data[gi] < 120, '绿点应落在右上角');
  const back = tencentOcr.rotateJpegBase64(cw, 'ccw');
  const img2 = jpeg.decode(Buffer.from(back, 'base64'), { useTArray: true });
  assert.eq(img2.width, 6, '转回去宽复原');
  assert.eq(img2.height, 4, '转回去高复原');
  assert.eq(tencentOcr.rotateJpegBase64('not-a-jpeg', 'cw'), null, '非 JPEG 静默返回 null');
});

test('BL 转置检测：横长条＋低分触发；竖条不触发；高分不触发', async () => {
  const wide = [];
  for (let i = 0; i < 8; i++) wide.push(det('样元重行', 30, 40 + i * 70, 200, 62, 60));
  assert(tencentOcr.rotationSuspect(wide, 30), '横长条低分应怀疑转置');
  assert(!tencentOcr.rotationSuspect(wide, 80), '高分不触发（防误伤横排文档）');
  const tall = [];
  for (let i = 0; i < 8; i++) tall.push(det('张三', 30 + i * 60, 40, 46, 190, 90));
  assert(!tencentOcr.rotationSuspect(tall, 30), '竖条碎片不触发');
});

const ENV = { TENCENT_SECRET_ID: 'AKIDbltest00000000000000000000000', TENCENT_SECRET_KEY: 'bltestsecretkey000000000000' };
const okResp = (dets) => ({ status: 200, json: { Response: { TextDetections: dets, RequestId: 'r1' } } });

test('BL 端到端：转置照片自动转正重识并取优，留痕标 rotated', async () => {
  const origB64 = makeJpegB64(64, 48);
  const cwB64 = tencentOcr.rotateJpegBase64(origB64, 'cw');
  const garbage = [];
  for (let i = 0; i < 8; i++) garbage.push(det('样元重行礼贺', 30, 40 + i * 70, 200, 62, 60));
  const clean = [det('張三壹仟元整', 200, 50, 42, 300, 95), det('李四伍佰元整', 320, 50, 42, 300, 94)];
  let calls = 0;
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      calls += 1;
      const b64 = JSON.parse(req.body).ImageBase64;
      return okResp(b64 === cwB64 ? clean : garbage);
    },
  });
  const rows = await adapter.recognize('cloud://fake/rotated.jpg', { imageBase64: origB64 });
  assert(calls >= 2, '转置照片应至少多调一轮');
  assert.eq(rows.length, 2, '转正后应认出两笔');
  assert.eq(rows[0].name, '张三', '转正后姓名');
  assert.eq(rows[0].amountFen, 100000, '转正后金额');
  assert.eq(rows.ocrTrace.rotated, 'cw', '留痕应标明转正方向');
});

test('BL 端到端：正常竖排照片不触发转正（只调一轮）', async () => {
  const origB64 = makeJpegB64(64, 48);
  const clean = [det('張三壹仟元整', 200, 50, 42, 300, 95), det('李四伍佰元整', 320, 50, 42, 300, 94)];
  let calls = 0;
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async () => { calls += 1; return okResp(clean); },
  });
  const rows = await adapter.recognize('cloud://fake/upright.jpg', { imageBase64: origB64 });
  assert.eq(rows.length, 2, '正常照片两笔');
  assert.eq(calls, 1, '正常照片只调一轮');
  assert(!rows.ocrTrace.rotated, '留痕不标转正');
});
