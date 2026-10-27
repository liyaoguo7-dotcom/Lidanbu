/**
 * AS批行为测试：OCR 识别质量修复。
 * ① 中文金额换算（大写/小写＋单位，姓名末字是数字字不被吞）；
 * ② 横排同水平带合并（同行不拆笔）＋金额栏按 Y 就近配对；
 * ③ 竖排模式（列序左到右、列内自上而下、同列多笔、单字竖列、贺礼滤除）；
 * ④ 质量门 assessQuality 与适配器取优（乱码/低置信触发手写补跑）；
 * ⑤ 繁体转简体（姓名出口）。
 * 全部合成 detections/打桩，绝不真连网。
 */
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const tencentOcr = require(path.join(API_DIR, 'tencent-ocr.js'));
// eslint-disable-next-line import/no-dynamic-require
const zhT2s = require(path.join(API_DIR, 'zh-t2s.js'));

const det = (text, x, y, w = 220, h = 30, conf) => {
  const d = { DetectedText: text, ItemPolygon: { X: x, Y: y, Width: w, Height: h } };
  if (typeof conf === 'number') d.Confidence = conf;
  return d;
};
const split = (t) => tencentOcr.splitNameAmount(t);

/* ---------- ① 中文金额换算 ---------- */

test('AS 金额：中文大写金额换算成数字（壹仟元整/伍佰/贰万叁仟/玖拾/壹佰贰拾叁）', async () => {
  assert.eq(split('壹仟元整').amountFen, 100000, '壹仟元整 → 1000 元');
  assert.eq(split('壹仟元整').name, '', '整段是金额不得当姓名');
  assert.eq(split('伍佰').amountFen, 50000, '伍佰 → 500 元');
  assert.eq(split('贰万叁仟').amountFen, 2300000, '贰万叁仟 → 23000 元');
  assert.eq(split('玖拾').amountFen, 9000, '玖拾 → 90 元');
  assert.eq(split('壹佰贰拾叁').amountFen, 12300, '壹佰贰拾叁 → 123 元');
});

test('AS 金额：小写中文金额与姓名同行（陈小明 伍佰元整 / 三百五十）', async () => {
  const a = split('陈小明 伍佰元整');
  assert.eq(a.name, '陈小明', '姓名保留');
  assert.eq(a.amountFen, 50000, '伍佰元整 → 500 元');
  const b = split('三百五十');
  assert.eq(b.amountFen, 35000, '三百五十 → 350 元');
  assert.eq(b.name, '', '纯金额行姓名占位');
  const c = split('张三 一千零一');
  assert.eq(c.name, '张三', '姓名末字不被金额吞');
  assert.eq(c.amountFen, 100100, '一千零一 → 1001 元');
  // 样例图金额只有两档、全是大写带「元」尾：贰佰元/伍佰元必须覆盖
  assert.eq(split('贰佰元').amountFen, 20000, '贰佰元 → 200 元');
  assert.eq(split('伍佰元').amountFen, 50000, '伍佰元 → 500 元');
});

test('AS 金额：人名里的数字字不误判（万三/张三丰/王二麻）', async () => {
  assert.eq(split('万三').amountFen, null, '「万三」是人名不是金额（万前无数字）');
  assert.eq(split('万三').name, '万三', '人名保留');
  assert.eq(split('张三丰').amountFen, null, '张三丰无金额');
  const d = split('王二麻 2000');
  assert.eq(d.name, '王二麻', '二麻不进金额');
  assert.eq(d.amountFen, 200000, '阿拉伯金额照旧');
});

/* ---------- ② 横排同行合并 ---------- */

test('AS 横排：姓名与金额在同一水平带（基线略偏）必须合成一笔', async () => {
  const rows = tencentOcr.parseDetections([
    det('张三', 40, 100, 200, 28), det('1000', 40, 106, 200, 20),
    det('李四', 40, 160, 200, 28), det('500', 40, 166, 200, 20),
  ]);
  assert.eq(rows.length, 2, '同带碎片应合为两笔而不是四笔');
  assert.eq(rows[0].name, '张三', '第一笔姓名');
  assert.eq(rows[0].amountFen, 100000, '第一笔金额');
  assert.eq(rows[1].name, '李四', '第二笔姓名');
  assert.eq(rows[1].amountFen, 50000, '第二笔金额');
});

test('AS 横排：金额栏行数与姓名栏不等时按 Y 就近配对（不再整批拆开）', async () => {
  const rows = tencentOcr.parseDetections([
    det('张三', 40, 100, 60), det('李四 500', 40, 160, 140), det('王五', 40, 220, 60),
    det('1000', 300, 102, 60), det('200', 300, 222, 60),
  ]);
  assert.eq(rows.length, 3, '三笔齐全');
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.amountFen]));
  assert.eq(byName['张三'], 100000, '张三配同行 1000');
  assert.eq(byName['李四'], 50000, '李四自带 500 不被覆盖');
  assert.eq(byName['王五'], 20000, '王五配同行 200');
});

/* ---------- ③ 竖排模式 ---------- */

const vdet = (text, x, y, w = 26, h = 200) => det(text, x, y, w, h);

test('AS 竖排：整列竖条按左到右成列、列内拼读拆姓名/大写金额', async () => {
  const rows = tencentOcr.parseDetections([
    vdet('陳小明伍佰元整', 300, 50), vdet('張三壹仟元整', 200, 50), vdet('李四玖拾', 100, 50),
  ]);
  assert.eq(rows.length, 3, '三列三笔，跨列不串');
  assert.eq(rows.map((r) => r.name).join(','), '李四,张三,陈小明', '列序左到右（冻结契约）＋繁转简');
  assert.eq(rows.map((r) => r.amountFen).join(','), '9000,100000,50000', '列内金额（大写）拆出');
});

test('AS 竖排：同一列里连写两笔按金额切开', async () => {
  const rows = tencentOcr.parseDetections([vdet('王五叁佰赵六贰佰', 200, 50)]);
  assert.eq(rows.length, 2, '一列两笔');
  assert.eq(rows[0].name, '王五', '第一笔姓名（末字五不被吞）');
  assert.eq(rows[0].amountFen, 30000, '叁佰 → 300');
  assert.eq(rows[1].name, '赵六', '第二笔姓名');
  assert.eq(rows[1].amountFen, 20000, '贰佰 → 200');
});

test('AS 竖排：单字逐个成框竖排成列也能切竖排模式', async () => {
  const sq = (text, x, y) => det(text, x, y, 24, 24);
  const rows = tencentOcr.parseDetections([
    sq('张', 300, 50), sq('三', 300, 80), sq('壹', 300, 110), sq('仟', 300, 140),
    sq('李', 200, 50), sq('四', 200, 80), sq('玖', 200, 110), sq('拾', 200, 140),
  ]);
  assert.eq(rows.length, 2, '两列两笔');
  assert.eq(rows[0].name, '李四', '左列先行，拼读成名');
  assert.eq(rows[0].amountFen, 9000, '玖拾 → 90');
  assert.eq(rows[1].name, '张三', '右列姓名');
  assert.eq(rows[1].amountFen, 100000, '壹仟 → 1000');
});

/**
 * AS 竖排样例夹具（用户补发的原图 1000090675：红纸礼单 12 列、左→右）：
 * 每列结构固定＝顶部竖写姓名＋中段纸面印刷红字「贺礼」（非内容、须滤除）
 * ＋下方竖写大写金额（只有贰佰元 200/伍佰元 500 两档）。合成 detections
 * 按此版式造：列宽均匀、每列三段碎片。真值姓名按用户人工读图（左→右）：
 * 張宏/宋耀祥/沈鹏/侯娜/陈志艳/（模糊·年→夹具用赵小年）/黑二毛/徐雪琳/
 * 張雪乖/李木生/刘文明/（模糊·峰→夹具用王小峰）。
 */
test('AS 竖排样例：12 列红纸礼单（贺礼印刷字滤除＋左到右＋大写两档金额）', async () => {
  const truth = [
    ['張宏', '贰佰元', 20000], ['宋耀祥', '贰佰元', 20000], ['沈鹏', '伍佰元', 50000],
    ['侯娜', '伍佰元', 50000], ['陈志艳', '伍佰元', 50000], ['赵小年', '伍佰元', 50000],
    ['黑二毛', '贰佰元', 20000], ['徐雪琳', '伍佰元', 50000], ['張雪乖', '伍佰元', 50000],
    ['李木生', '贰佰元', 20000], ['刘文明', '贰佰元', 20000], ['王小峰', '伍佰元', 50000],
  ];
  const dets = [];
  truth.forEach(([name, amount], i) => {
    const x = 30 + i * 92;
    dets.push(det(name, x, 40, 30, 110)); // 顶部竖写姓名
    dets.push(det('贺礼', x, 170, 30, 44)); // 中段纸面印刷字（须滤除）
    dets.push(det(amount, x, 240, 30, 110)); // 下方竖写大写金额
  });
  const rows = tencentOcr.parseDetections(dets);
  assert.eq(rows.length, 12, '恰好 12 笔：列内成笔、跨列不串、贺礼不单独成笔');
  assert.eq(
    rows.map((r) => r.name).join(','),
    '张宏,宋耀祥,沈鹏,侯娜,陈志艳,赵小年,黑二毛,徐雪琳,张雪乖,李木生,刘文明,王小峰',
    '左到右姓名与真值一致（繁转简）且无贺礼残留',
  );
  assert.eq(
    rows.map((r) => r.amountFen).join(','),
    truth.map((t) => t[2]).join(','),
    '金额只有 200/500 两档（大写）',
  );
});

/* ---------- ④ 质量门 ---------- */

test('AS 质量门：拉丁乱码/低置信/单字碎片任一命中即判质量差', async () => {
  const gib = tencentOcr.assessQuality([det('mnhmhmm', 10, 10), det('礼礼礼', 10, 50)]);
  assert(gib.bad && gib.reasons.includes('latin-gibberish'), '连续拉丁字母应判乱码');
  const low = tencentOcr.assessQuality([det('张三 1000', 10, 10, 220, 30, 40), det('李四 500', 10, 50, 220, 30, 42)]);
  assert(low.bad && low.reasons.includes('low-confidence'), '平均置信度 41 < 70 应判低');
  const singles = tencentOcr.assessQuality([
    det('张', 10, 10), det('贺', 10, 40), det('礼', 10, 70), det('云', 10, 100), det('鹏', 10, 130),
  ]);
  assert(singles.bad && singles.reasons.includes('single-char-fragments'), '单字碎片占比 100% 应判碎片化');
  const good = tencentOcr.assessQuality([det('张三 1000', 10, 10, 220, 30, 96), det('李四 500', 10, 50, 220, 30, 94)]);
  assert(!good.bad, '正常识别结果不应判差');
});

const ENV = { TENCENT_SECRET_ID: 'AKIDastest000000000000000000000000', TENCENT_SECRET_KEY: 'astestsecretkey000000000000000' };
const okResp = (dets) => ({ status: 200, json: { Response: { TextDetections: dets, RequestId: 'r1' } } });

test('AS 质量门：手写优先常态——手写竖排过关只调手写一次（1 次/图）', async () => {
  const actions = [];
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      actions.push(req.headers['X-TC-Action']);
      return okResp([vdet('陳小明伍佰元整', 300, 50), vdet('張三壹仟元整', 200, 50)]);
    },
  });
  const rows = await adapter.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' });
  assert.eq(actions.join(','), 'GeneralHandwritingOCR', '手写过关不补调印刷');
  assert.eq(rows.length, 2, '手写竖排两笔');
  assert.eq(rows[0].name, '张三', '手写竖排左列先行（x=200 列）');
  assert.eq(rows[0].amountFen, 100000, '手写竖排左列金额');
  assert.eq(rows[1].name, '陈小明', '手写竖排右列姓名');
  assert.eq(rows[1].amountFen, 50000, '手写竖排右列金额');
});

test('AS 质量门：手写质量差 → 补印刷取优；印刷更差时仍用手写', async () => {
  const actions = [];
  const rescued = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => {
      actions.push(req.headers['X-TC-Action']);
      if (req.headers['X-TC-Action'] === 'GeneralBasicOCR') {
        return okResp([det('张三 1000', 10, 10, 220, 30, 96), det('李四 500', 10, 60, 220, 30, 95)]);
      }
      return okResp([det('mnhmhmm', 10, 10), det('礼礼礼', 10, 60), det('9.00', 10, 110)]);
    },
  });
  const rows = await rescued.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' });
  assert.eq(actions.join(','), 'GeneralHandwritingOCR,GeneralBasicOCR', '手写判差应补调印刷');
  assert.eq(rows.length, 2, '取优后用印刷结果两笔');
  assert.eq(rows[0].name, '张三', '印刷结果姓名');

  const worse = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async (req) => (req.headers['X-TC-Action'] === 'GeneralBasicOCR'
      ? okResp([det('xyzwq', 10, 10), det('a', 10, 50), det('b', 10, 90), det('c', 10, 130), det('d', 10, 170)])
      : okResp([det('mnhmhmm 100', 10, 10)])),
  });
  const rows2 = await worse.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' });
  assert.eq(rows2.length, 1, '两份都差时取分高者（手写）');
  /* BK批姓名硬顶：用户定的规律（99% ≤3 字、极个别 4 字）——超 4 字
   * 的"名字"必是拼装事故，出口截回 4 字，本例乱码名 mnhmhmm → mnhm */
  assert.eq(rows2[0].name, 'mnhm', '印刷更差则仍用手写结果（姓名经 BK 硬顶截断）');
});

/* ---------- ⑥ AS-8 识别留痕 ---------- */

test('AS-8 留痕：真实适配器给结果挂 ocrTrace（接口/质量分/碎片四点坐标/置信度）', async () => {
  const adapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async () => okResp([det('何九 888', 10, 10, 220, 30, 93)]),
  });
  const rows = await adapter.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' });
  assert(rows.ocrTrace, '真实适配器结果应带留痕');
  assert.eq(rows.ocrTrace.chosen, 'handwriting', '留痕记最终采用的接口');
  assert.eq(rows.ocrTrace.calls.length, 1, '常态只调一次、记一份');
  const call = rows.ocrTrace.calls[0];
  assert.eq(call.action, 'GeneralHandwritingOCR', '留痕记接口名');
  assert.eq(call.fragments.length, 1, '留痕记碎片数');
  assert.eq(call.fragments[0].text, '何九 888', '留痕记碎片原文');
  assert.eq(call.fragments[0].confidence, 93, '留痕记置信度');
  assert.eq(call.fragments[0].polygon.length, 4, '留痕记四点坐标');
});

test('AS-8 留痕：超大结果截断并标 truncated（体积有上限）', async () => {
  const many = [];
  for (let i = 0; i < 1200; i++) many.push(det(`碎片${i}号张三 100`, (i % 40) * 60, Math.floor(i / 40) * 40, 50, 30, 90));
  const adapter = tencentOcr.createAdapter({ env: ENV, httpPost: async () => okResp(many) });
  const rows = await adapter.recognize('cloud://fake/x.jpg', { imageBase64: 'aA==' });
  assert(rows.ocrTrace.truncated === true, '超限应标 truncated');
  assert(JSON.stringify(rows.ocrTrace).length <= 60000, '留痕 JSON 不超过上限');
});

test('AS-8 留痕落库：真实识别写 importJobs 留痕文档（ocrRaw），Mock 不写', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'as-trace-owner', { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
  await core.points.grant(db, owner, 100, { kind: 'manual', refId: 'seed:as-trace', note: '测试充值' });
  const realAdapter = tencentOcr.createAdapter({
    env: ENV,
    httpPost: async () => okResp([det('何九 888', 10, 10, 220, 30, 93)]),
    fetchImage: async () => Buffer.from('fake-jpeg'),
  });
  const r = await core.importer.startImportTask(db, owner, owner, {
    jobId: 'as-job-trace', kind: 'gift', imagePath: 'cloud://fake/p.jpg', ocrAdapter: realAdapter,
  });
  assert.eq(r.items[0].name, '何九', '识别结果照常返回');
  assert(!('ocrTrace' in r.items), '留痕不随条目回给页面');
  const jobs = await db.collection(core.models.COLLECTIONS.ImportJob).find({});
  const traces = jobs.filter((j) => j.status === 'recognized');
  assert.eq(traces.length, 1, '真实识别应落一条留痕文档');
  assert.eq(traces[0].jobId, 'as-job-trace', '留痕挂在对应任务上');
  assert.eq(traces[0].ocrRaw.calls[0].action, 'GeneralHandwritingOCR', 'ocrRaw 记接口');
  assert.eq(traces[0].ocrRaw.calls[0].fragments[0].text, '何九 888', 'ocrRaw 记原始碎片（可离线重放）');

  const db2 = await h.newDB();
  const owner2 = await h.newUser(db2, 'as-mock-owner', { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
  await core.points.grant(db2, owner2, 100, { kind: 'manual', refId: 'seed:as-mock', note: '测试充值' });
  await core.importer.startImportTask(db2, owner2, owner2, { jobId: 'as-job-mock', kind: 'gift', imagePath: 'wxfile://ok.jpg' });
  const jobs2 = await db2.collection(core.models.COLLECTIONS.ImportJob).find({});
  assert.eq(jobs2.filter((j) => j.status === 'recognized').length, 0, 'Mock 路径不写留痕');
});

/* ---------- ⑦ 繁体转简体 ---------- */

test('AS 繁简：姓名出口繁转简（張小明→张小明、劉德華→刘德华），金额不动', async () => {
  assert.eq(split('張小明 500').name, '张小明', '張→张');
  assert.eq(split('張小明 500').amountFen, 50000, '金额照旧');
  assert.eq(split('劉德華').name, '刘德华', '劉→刘、華→华');
  const rows = tencentOcr.parseDetections([det('陳楊 800', 10, 10)]);
  assert.eq(rows[0].name, '陈杨', '解析出口同样转简');
  assert(zhT2s.PAIR_COUNT >= 150, `繁简对照表应至少 150 对（实际 ${zhT2s.PAIR_COUNT}）`);
});
