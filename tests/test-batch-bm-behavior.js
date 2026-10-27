'use strict';
/* BM批行为测试：双调取优（用户 2026-10-27 晚拍板试效果）
 * 手写、印刷都调，按含姓名可信度的质量分选优——手写在模板单上读出
 * 垃圾长名（那来河无类）但旧质量门不判差时，不许再短路蒙混过关。 */
const { test, assert } = require('./fw');
const tencentOcr = require('../cloudfunctions/api/tencent-ocr');

function det(text, x, y, w, h, conf) {
  return {
    DetectedText: text,
    Confidence: conf == null ? 92 : conf,
    Polygon: [
      { X: x, Y: y }, { X: x + w, Y: y },
      { X: x + w, Y: y + h }, { X: x, Y: y + h },
    ],
    ItemPolygon: null,
  };
}
const ENV = { TENCENT_SECRET_ID: 'AKIDbmtest00000000000000000000000', TENCENT_SECRET_KEY: 'bmtestsecretkey000000000000' };
const okResp = (dets) => ({ status: 200, json: { Response: { TextDetections: dets, RequestId: 'r1' } } });

test('BM 双调取优：手写垃圾长名（旧门不判差）时印刷胜出', async () => {
  /* 手写：整列条读＋错名（天持盼住——天不是姓），置信度不低、旧三项不判差 */
  const hwDets = [
    det('天持盼住佰无', 60, 40, 48, 420, 92),
    det('那来河无', 130, 40, 48, 300, 91),
    det('500', 60, 543, 40, 30, 95),
    det('500', 130, 546, 40, 30, 95),
  ];
  /* 印刷：同图读出真名（吴/郭皆真姓、字皆姓名用字） */
  const printDets = [
    det('吴诗峰伍佰元', 60, 40, 48, 420, 90),
    det('郭永河伍佰元', 130, 40, 48, 420, 90),
  ];
  const actions = [];
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      const a = req.headers['X-TC-Action'];
      actions.push(a);
      return okResp(a === 'GeneralBasicOCR' ? printDets : hwDets);
    },
  });
  const rows = await adapter.recognize('cloud://fake/template.jpg', { imageBase64: 'aA==' });
  assert.eq(actions.join(','), 'GeneralHandwritingOCR,GeneralBasicOCR', '两引擎都调');
  assert.eq(rows.ocrTrace.chosen, 'print', '印刷应胜出');
  const names = rows.map((r) => r.name).join(',');
  assert(names.includes('吴诗峰') && names.includes('郭永河'), `应采用印刷真名，实际 ${names}`);
});

test('BM 双调取优：手写明显更好时仍取手写', async () => {
  const hwDets = [det('張三壹仟元整', 200, 50, 42, 300, 95), det('李四伍佰元整', 320, 50, 42, 300, 94)];
  const printDets = [det('弓长三 1000', 10, 10, 220, 30, 60), det('木子四 500', 10, 60, 220, 30, 58)];
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => okResp(req.headers['X-TC-Action'] === 'GeneralBasicOCR' ? printDets : hwDets),
  });
  const rows = await adapter.recognize('cloud://fake/hand.jpg', { imageBase64: 'aA==' });
  assert.eq(rows.ocrTrace.chosen, 'handwriting', '手写更好应取手写');
  assert.eq(rows[0].name, '张三', '手写姓名');
});
