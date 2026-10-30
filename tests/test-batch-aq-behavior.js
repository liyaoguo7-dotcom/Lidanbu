/**
 * AQ批行为测试：腾讯云 OCR 接入。
 * ① TC3 签名固定输入可复现；② 解析器（分栏/顺序/姓名金额拆分/占位行）；
 * ③ 适配器策略（印刷优先、手写兜底、mode 指定、厂商错误口径）；
 * ④ api 分发选择三格（无密钥→mock、密钥+非管理员→mock、密钥+管理员→tencent）。
 * 全部打桩，绝不真连网；密钥用假值且只走环境变量，测后恢复。
 */
const path = require('path');
const { test, assert } = require('./fw');
const { makeFakeSdk } = require('./fake-cloud-sdk');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const apiCore = require(path.join(API_DIR, 'core'));
// eslint-disable-next-line import/no-dynamic-require
const { createMain } = require(path.join(API_DIR, 'index.js'));
// eslint-disable-next-line import/no-dynamic-require
const tencentOcr = require(path.join(API_DIR, 'tencent-ocr.js'));

const FAKE_ID = 'AKIDaqtest0000000000000000000000000';
const FAKE_KEY = 'aqtestsecretkey0000000000000000';

/* ---------- ① TC3 签名 ---------- */

test('AQ 签名：固定时间戳/载荷下 Authorization 可复现且结构正确', async () => {
  const input = {
    secretId: FAKE_ID, secretKey: FAKE_KEY, action: 'GeneralBasicOCR',
    timestamp: 1700000000, payload: JSON.stringify({ ImageBase64: 'aGVsbG8=' }),
  };
  const a = tencentOcr.buildAuthorization(input);
  const b = tencentOcr.buildAuthorization(input);
  assert.eq(a.authorization, b.authorization, '同样输入两次签名必须一致');
  assert(
    /^TC3-HMAC-SHA256 Credential=AKIDaqtest0000000000000000000000000\/2023-11-14\/ocr\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/.test(a.authorization),
    `Authorization 结构应为 TC3 口径（实际：${a.authorization.slice(0, 80)}…）`,
  );
  const c = tencentOcr.buildAuthorization({ ...input, payload: JSON.stringify({ ImageBase64: 'b3RoZXI=' }) });
  assert(c.authorization !== a.authorization, '载荷不同签名必须不同');
  // 注：按腾讯云 TC3 官方文档口径，参与签名的头只有 content-type;host；
  // 接口名走 X-TC-Action 头发送、不进签名——同载荷同时间戳换接口签名相同
  // 属预期（适配器行为测试另断言 X-TC-Action 头正确）。
});

test('AQ 配置：环境变量缺一即未配置，地域缺省 ap-guangzhou', async () => {
  assert.eq(tencentOcr.isConfigured({}), false, '无密钥应为未配置');
  assert.eq(tencentOcr.isConfigured({ TENCENT_SECRET_ID: FAKE_ID }), false, '缺 SecretKey 未配置');
  assert.eq(tencentOcr.isConfigured({ TENCENT_SECRET_ID: FAKE_ID, TENCENT_SECRET_KEY: FAKE_KEY }), true, '双密钥齐全才算配置');
  assert.eq(tencentOcr.getConfig({}).region, 'ap-guangzhou', '地域缺省 ap-guangzhou');
  assert.eq(tencentOcr.getConfig({ TENCENT_OCR_REGION: 'ap-shanghai' }).region, 'ap-shanghai', '地域可由 env 覆盖');
});

/* ---------- ② 解析器 ---------- */

const det = (text, x, y, w = 220, h = 30) => ({ DetectedText: text, ItemPolygon: { X: x, Y: y, Width: w, Height: h } });

test('AQ 解析：双栏礼单先左栏自上而下、再右栏（冻结顺序契约）', async () => {
  const rows = tencentOcr.parseDetections([
    det('李五 500', 460, 100), det('张三 1000', 40, 100),
    det('王二麻 2000', 460, 150), det('赵六 800', 40, 150),
  ]);
  assert.eq(rows.map((r) => r.name).join(','), '张三,赵六,李五,王二麻', '顺序应为左栏上下→右栏上下');
  assert.eq(rows.map((r) => r.amountFen).join(','), '100000,80000,50000,200000', '金额元→分');
});

test('AQ 解析：姓名/金额被拆成碎片时按序合并、不丢行', async () => {
  const rows = tencentOcr.parseDetections([
    det('张三', 40, 100, 60), det('1000', 150, 100, 60),
    det('李五', 42, 150, 60), det('500', 152, 150, 60),
  ]);
  assert.eq(rows.length, 2, '两行不应多也不应少');
  assert.eq(rows[0].name, '张三', '第一行姓名');
  assert.eq(rows[0].amountFen, 100000, '第一行金额由金额碎片合并');
  assert.eq(rows[1].name, '李五', '第二行姓名');
  assert.eq(rows[1].amountFen, 50000, '第二行金额');
});

test('AQ 解析：只有姓名的行保留、金额留空；只有金额的行保留空姓名占位', async () => {
  const rows = tencentOcr.parseDetections([
    det('王五', 40, 100), det('600', 40, 150), det('陈六 1000.50', 40, 200),
    det('周七 2,000', 40, 250), det('吴八 ¥800元', 40, 300),
  ]);
  assert.eq(rows.length, 5, '五行全保留');
  assert.eq(rows[0].name, '王五', '姓名行');
  assert.eq(rows[0].amountFen, null, '无金额留空待核对页补');
  assert.eq(rows[1].name, '', '金额行姓名占位为空');
  assert.eq(rows[1].amountFen, 60000, '金额行金额');
  assert.eq(rows[2].amountFen, 100050, '小数金额 1000.50 → 100050 分');
  assert.eq(rows[3].amountFen, 200000, '千分位 2,000 → 200000 分');
  assert.eq(rows[4].name, '吴八', '¥ 与"元"不进姓名');
  assert.eq(rows[4].amountFen, 80000, '¥800元 → 80000 分');
});

test('AQ 解析：手写体同形响应（只有 Polygon）可解析；空响应回空数组', async () => {
  const rows = tencentOcr.parseDetections([
    { DetectedText: '孙九 300', Polygon: [{ X: 10, Y: 10 }, { X: 200, Y: 10 }, { X: 200, Y: 40 }, { X: 10, Y: 40 }] },
  ]);
  assert.eq(rows.length, 1, '手写体一行');
  assert.eq(rows[0].name, '孙九', '手写体姓名');
  assert.eq(rows[0].amountFen, 30000, '手写体金额');
  assert.eq(tencentOcr.parseDetections([]).length, 0, '空响应 → 空 rows');
  assert.eq(tencentOcr.parseDetections([{ DetectedText: '   ' }]).length, 0, '空白碎片不算一行');
});

/* ---------- ③ 适配器策略（HTTP 打桩） ---------- */

const ENV = { TENCENT_SECRET_ID: FAKE_ID, TENCENT_SECRET_KEY: FAKE_KEY };
const okResp = (dets) => ({ status: 200, json: { Response: { TextDetections: dets, RequestId: 'r1' } } });

test('AQ 适配器：未指定模式双调取优（BM批），两引擎都调；请求头/载荷合规', async () => {
  const calls = [];
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => { calls.push(req); return okResp([det('张三 1000', 10, 10)]); },
  });
  const rows = await adapter.recognize('cloud://fake/x.jpg', { imageBase64: 'aGVsbG8=' });
  assert.eq(calls.length, 2, 'BM 后两引擎都调（双调取优）');
  assert.eq(calls[0].headers['X-TC-Action'], 'GeneralHandwritingOCR', '先调手写体');
  assert.eq(calls[0].headers['X-TC-Version'], '2018-11-19', '版本头');
  assert(/^TC3-HMAC-SHA256 /.test(calls[0].headers.Authorization), '带 TC3 签名头');
  assert.eq(JSON.parse(calls[0].body).ImageBase64, 'aGVsbG8=', '载荷带 ImageBase64');
  assert.eq(rows[0].name, '张三', '识别结果姓名');
  assert.eq(rows[0].amountFen, 100000, '识别结果金额');
});

test('AQ 适配器：手写空结果 → 印刷体兜底（AS批手写优先后的兜底向）；mode=print 只调印刷体', async () => {
  const actions = [];
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      actions.push(req.headers['X-TC-Action']);
      return req.headers['X-TC-Action'] === 'GeneralBasicOCR'
        ? okResp([det('印刷名 300', 10, 10)]) : okResp([]);
    },
  });
  const rows = await adapter.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' });
  assert.eq(actions.join(','), 'GeneralHandwritingOCR,GeneralBasicOCR', '手写空 → 印刷兜底顺序');
  assert.eq(rows[0].name, '印刷名', '兜底结果来自印刷体');

  actions.length = 0;
  const rows2 = await adapter.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==', mode: 'print' });
  assert.eq(actions.join(','), 'GeneralBasicOCR', 'mode=print 只调印刷体');
  assert.eq(rows2[0].amountFen, 30000, '印刷模式金额');
});

test('AQ 适配器：两接口都空 → 抛「没认出来」（不扣费口径）；厂商报错 → ocr-failed', async () => {
  const empty = tencentOcr.createAdapter({ env: ENV, httpPost: async () => okResp([]) });
  let e1 = null;
  try { await empty.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' }); } catch (e) { e1 = e; }
  assert(e1 && /没认出来/.test(e1.message), '全空应抛没认出来（识别失败不扣费）');

  const broken = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async () => ({ status: 200, json: { Response: { Error: { Code: 'FailedOperation.UnknowError', Message: 'x' }, RequestId: 'r' } } }),
  });
  let e2 = null;
  try { await broken.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' }); } catch (e) { e2 = e; }
  assert(e2 && e2.code === 'ocr-failed', '厂商报错应归一为 ocr-failed，不外漏厂商细节');
});

/* ---------- ④ api 选择三格 ---------- */

const SEED = {
  features: { photoImport: true }, // AF 总闸：开闸才进得到识别层
  memberOnlyFeatures: [], // 名单不含 photoImport：隔离会员门禁，专测 OCR 选择
  adminIds: ['aq-admin'], addedAdminIds: [],
};
const OCR_DETS = [det('何九 888', 10, 10)];

function makeMain(openid, { httpPost, downloadFile } = {}) {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: openid });
  const db = new apiCore.db.CloudDB({ sdk });
  const main = createMain({ sdk, core: apiCore, db, ocrHttpPost: httpPost, downloadFile });
  return { main, db };
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_OCR_REGION']) {
    saved[k] = process.env[k];
    if (vars[k]) process.env[k] = vars[k]; else delete process.env[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

async function startViaApi(openid, opts = {}) {
  const { main, db } = makeMain(openid, opts);
  await db.collection('appConfig').insert({ _id: 'singleton', ...SEED });
  return main({
    action: 'importer.startImportTask',
    args: [openid, { kind: 'gift', imagePath: 'cloud://fake-env.fake-bucket/import/p.jpg' }],
  });
}

test('AQ 选择：无密钥 → 管理员也走 Mock（行为与接入前一致）', async () => {
  await withEnv({}, async () => {
    let called = 0;
    const r = await startViaApi('aq-admin', { httpPost: async () => { called += 1; return okResp(OCR_DETS); } });
    assert(r.ok === true, `应成功（实际 ${JSON.stringify(r)}）`);
    assert.eq(r.data.adapter, 'mock', '无密钥 adapter 应标 mock');
    assert.eq(r.data.items.length, 3, 'Mock 送礼 3 条');
    assert.eq(called, 0, '无密钥绝不发 OCR 请求');
  });
});

test('AQ 选择：有密钥但非管理员 → 仍走 Mock，OCR 零调用', async () => {
  await withEnv(ENV, async () => {
    let called = 0;
    const r = await startViaApi('aq-user', { httpPost: async () => { called += 1; return okResp(OCR_DETS); } });
    assert(r.ok === true, `应成功（实际 ${JSON.stringify(r)}）`);
    assert.eq(r.data.adapter, 'mock', '非管理员 adapter 应标 mock（公开开放待发话）');
    assert.eq(r.data.items.length, 3, '非管理员拿到 Mock 结果');
    assert.eq(called, 0, '非管理员绝不触发真实识别');
  });
});

test('AQ 选择：有密钥且管理员 → 真实适配器（取图→签名请求→解析；DQ 管理员不扣费）', async () => {
  await withEnv(ENV, async () => {
    const calls = [];
    const r = await startViaApi('aq-admin', {
      httpPost: async (req) => { calls.push(req); return okResp(OCR_DETS); },
      downloadFile: async () => Buffer.from('fake-jpeg-bytes'),
    });
    assert(r.ok === true, `应成功（实际 ${JSON.stringify(r)}）`);
    assert.eq(r.data.adapter, 'tencent', '管理员 adapter 应标 tencent');
    assert.eq(calls.length, 2, 'BM 双调取优发两次 OCR 请求（手写＋印刷）');
    assert.eq(calls[0].headers['X-TC-Action'], 'GeneralHandwritingOCR', '请求头含 X-TC-Action（先调手写）');
    assert(
      JSON.parse(calls[0].body).ImageBase64 === Buffer.from('fake-jpeg-bytes').toString('base64'),
      '请求体 ImageBase64 应为按 fileID 取回的图片字节',
    );
    assert.eq(r.data.items.length, 1, '解析出 1 条');
    assert.eq(r.data.items[0].name, '何九', '条目姓名');
    assert.eq(r.data.items[0].amountFen, 88800, '条目金额 888 元 → 88800 分');
    assert.eq(r.data.cost, 0, 'DQ 管理员免会员（2026-10-30 用户定）：管理员识别不扣费，cost 0');
  });
});
