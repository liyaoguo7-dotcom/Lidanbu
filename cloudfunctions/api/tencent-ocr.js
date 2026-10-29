/**
 * 礼单簿 · 腾讯云文字识别（OCR）真实适配器（AQ批，用户 2026-10-26 拍板）
 *
 * 只在云函数（服务端）运行，绝不进小程序包。密钥只从云函数环境变量读：
 *   TENCENT_SECRET_ID / TENCENT_SECRET_KEY（必填，任一缺失＝未配置）
 *   TENCENT_OCR_REGION（可选，缺省 ap-guangzhou）
 * 密钥不进代码、不进仓库、不进日志；日志只允许出现 adapter 名字（tencent/mock）。
 *
 * 接口：印刷体 GeneralBasicOCR、手写体 GeneralHandwritingOCR
 * （ocr.tencentcloudapi.com，版本 2018-11-19，TC3-HMAC-SHA256 签名）。
 * 调用策略（简单可解释，startImportTask 的 opts.mode 可指定）：
 *   mode='handwriting' → 只调手写体；
 *   mode='print'       → 只调印刷体；
 *   未指定             → 手写优先（纸质礼单多为手写，AS批用户定版）：
 *                        先调手写体，质量评估（assessQuality：拉丁乱码/
 *                        置信度低/单字碎片占比高任一命中即判差）过关
 *                        直接用——常态一张图只调 1 次；质量差或没认出
 *                        才补调印刷体，两份结果按同一质量分取优。
 * 两次都没认出（或图片取不到）→ 抛「这张照片没认出来」，走既有
 * "识别失败不扣费"语义（core/import 在识别成功后才扣积分）。
 *
 * 返回行与 MockOCR 完全同形：[{ name, amountFen|null, note, raw }]，
 * 顺序与完整性遵守 core/ocr-adapter 的冻结契约：横排整页先分栏（左栏
 * 在前）、栏内自上而下、行内碎片按 X 拼接；竖排（传统红纸礼单竖写，
 * 文本框高大于宽占多数）按 X 分列、列序左到右（与冻结契约一致）、
 * 列内自上而下拼读成笔，列中纸面印刷字「贺礼」「奠仪」（含繁体）拼读前滤除；
 * 金额支持阿拉伯数字与中文数字（大写壹贰叁…/小写一二三…＋拾佰仟万，
 * AS批）；姓名出口前繁体转简体（zh-t2s，AS批）；识别不出金额的行
 * 保留姓名、金额留空；只有金额的行保留空姓名占位；不丢行。
 *
 * HTTP 层可注入（opts.httpPost），测试一律打桩、绝不真连网；
 * 默认实现只用 Node 内置 https，零新增依赖。
 */
const crypto = require('crypto');
const https = require('https');
const { toSimplified } = require('./zh-t2s');
const NAME_DB = require('./name-db');

const SERVICE = 'ocr';
const HOST = 'ocr.tencentcloudapi.com';
const VERSION = '2018-11-19';
const DEFAULT_REGION = 'ap-guangzhou';

/* ---------------- 配置（只读环境变量） ---------------- */

function getConfig(env) {
  const e = env || process.env;
  const secretId = String(e.TENCENT_SECRET_ID || '').trim();
  const secretKey = String(e.TENCENT_SECRET_KEY || '').trim();
  const region = String(e.TENCENT_OCR_REGION || '').trim() || DEFAULT_REGION;
  return { secretId, secretKey, region, configured: !!(secretId && secretKey) };
}

function isConfigured(env) {
  return getConfig(env).configured;
}

/* ---------------- TC3-HMAC-SHA256 签名 ---------------- */

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

/**
 * 组装 Authorization 头（纯函数：同样输入必得同样输出，测试可复现）。
 * 签名头口径与腾讯云 TC3 官方文档一致：content-type;host。
 * @param payload 已序列化好的 JSON 字符串（签名与发送必须同一份字节）
 */
function buildAuthorization({ secretId, secretKey, action, timestamp, payload }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // UTC 日期
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(payload),
  ].join('\n');
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(`TC3${secretKey}`, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    credentialScope,
    date,
  };
}

/* ---------------- HTTP（默认实现，可注入打桩） ---------------- */

function defaultHttpPost({ host, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path: path || '/', method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON 响应按无结果处理 */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('OCR 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function ocrServiceError() {
  const e = new Error('识别服务暂时不可用，请稍后重试');
  e.code = 'ocr-failed';
  return e;
}

/* ---------------- 识别留痕（AS-8，调试用） ----------------
 * 每次真实识别把腾讯原始要素挂在返回 rows 的 ocrTrace 上，core 随
 * 导入任务落进 importJobs 文档的 ocrRaw 字段（仅真实适配器，Mock
 * 不写）：控制台打开对应任务复制该字段即可离线重放解析，不必再
 * 靠截图猜。体积上限 TRACE_MAX_CHARS，超了从碎片最多的调用尾部
 * 逐个削碎片并标 truncated。 */
const TRACE_MAX_CHARS = 60000;

function polygonPoints(d) {
  if (d && Array.isArray(d.Polygon) && d.Polygon.length) {
    return d.Polygon.map((p) => [p.X, p.Y]);
  }
  const b = d && d.ItemPolygon;
  if (b) return [[b.X, b.Y], [b.X + b.Width, b.Y], [b.X + b.Width, b.Y + b.Height], [b.X, b.Y + b.Height]];
  return [];
}

function buildTraceCall(action, detections, q) {
  return {
    action,
    score: Math.round(q.score * 10) / 10,
    bad: q.bad,
    reasons: q.reasons,
    fragments: (Array.isArray(detections) ? detections : []).map((d) => ({
      text: String((d && d.DetectedText) || ''),
      polygon: polygonPoints(d),
      /* BB批：ItemPolygon 一并留痕——bboxOf 优先用它算框，只存 Polygon
       * 会让离线重放与线上解析输入不一致（2026-10-27 真机 21 条定位教训） */
      itemPolygon: d && d.ItemPolygon && typeof d.ItemPolygon.X === 'number'
        ? { x: d.ItemPolygon.X, y: d.ItemPolygon.Y || 0, w: d.ItemPolygon.Width || 0, h: d.ItemPolygon.Height || 0 }
        : null,
      confidence: d && typeof d.Confidence === 'number' ? d.Confidence : null,
    })),
  };
}

function finalizeTrace(calls, chosen) {
  const trace = { calls, chosen };
  if (JSON.stringify(trace).length > TRACE_MAX_CHARS) {
    trace.truncated = true;
    while (JSON.stringify(trace).length > TRACE_MAX_CHARS) {
      const big = calls.reduce((a, c) => (c.fragments.length > (a ? a.fragments.length : 0) ? c : a), null);
      if (!big || !big.fragments.length) break;
      big.fragments.pop();
    }
  }
  return trace;
}

/* ---------------- 结果解析（纯函数） ---------------- */

function bboxOf(det) {
  /* BH批：优先用 Polygon 轮廓外框，不用 ItemPolygon——真机留痕实证：
   * 印刷引擎的 ItemPolygon 是粗定位框，系统性右移且过宽（如「往雪琳」
   * 轮廓框 x622/w68、ItemPolygon 却是 x690/w210，横跨邻列），拿它分列
   * 会把整页列位带偏（旧解析在本留痕上把「贺」「礼」都解成了姓名行）。
   * Polygon 是逐字紧框，分列/列序/列带定界都以它为准；ItemPolygon 只在
   * 无 Polygon 时兜底（手写引擎本来就只给 Polygon）。 */
  const poly = det && det.Polygon;
  if (Array.isArray(poly) && poly.length) {
    const xs = poly.map((p) => p.X || 0);
    const ys = poly.map((p) => p.Y || 0);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const ip = det && det.ItemPolygon;
  if (ip && typeof ip.X === 'number' && typeof ip.Width === 'number') {
    return { x: ip.X, y: ip.Y || 0, w: ip.Width, h: ip.Height || 0 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

/** 两区间重叠长度占较窄者宽度的比例；零宽按"点是否落在对方区间内"处理 */
function overlapRatio(aMin, aW, bMin, bW) {
  const overlap = Math.min(aMin + aW, bMin + bW) - Math.max(aMin, bMin);
  const minW = Math.min(aW, bW);
  if (minW <= 0) {
    const aPt = aW <= 0 ? aMin : null;
    const bPt = bW <= 0 ? bMin : null;
    if (aPt !== null && bPt !== null) return aPt === bPt ? 1 : 0;
    if (aPt !== null) return aPt >= bMin && aPt <= bMin + bW ? 1 : 0;
    if (bPt !== null) return bPt >= aMin && bPt <= aMin + aW ? 1 : 0;
    return 0;
  }
  return overlap / minW;
}

/* ---------------- 中文数字金额（AS批） ----------------
 * 礼单金额常写中文：大写 壹贰叁肆伍陆柒捌玖＋拾佰仟万，或小写
 * 一二三四五…＋十百千万。按中文计数法换算成「元」数值：
 * 数字定值、十百千为节内单位（无前置数字按 1 计，如「拾伍」=15）、
 * 万/亿结算高位节。纯数字串（如姓名里的「三」）无单位不成金额。 */
const CH_DIGITS = {
  零: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  壹: 1, 贰: 2, 貳: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 陸: 6, 柒: 7, 捌: 8, 玖: 9,
};
const CH_SMALL = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
const CH_BIG = { 万: 10000, 萬: 10000, 亿: 100000000, 億: 100000000 };
/* CA批（用户定：大写数字就那几个，可以猜）：手写大写金额常被引擎误读
 * 成形近字（如伍→吾/午/他、贰→式/弍、陆→睦、柒→漆），标准解析只认真
 * 数字字，误读串直接丢金额、核对页留空。猜读表只在金额串语境用：
 * 数字形近字恒映射（单字无单位仍不成金额，不会把姓名变金额）；单位
 * 形近字伯→佰只在串里已有真数字时才映射（防“刘伯”这类姓名被当成
 * 佰位）。映射是一一换字、长度不变，金额下标不受影响。 */
const CH_GUESS_DIGIT = { 吾: '伍', 午: '伍', 他: '伍', 式: '贰', 弍: '贰', 叄: '叁', 睦: '陆', 漆: '柒', 桼: '柒' };
const CH_GUESS_UNIT = { 伯: '佰' };
const CH_RUN_RE = /[零一二三四五六七八九两兩壹贰貳叁肆伍陆陸柒捌玖十拾百佰千仟万萬亿億吾午他式弍叄睦漆桼伯]+/g;

/**
 * 一段纯中文数字串 → 元数值；形态不合法/无单位/无值返回 null。
 * 合法形态：数字与单位交替（两个数字不得相邻，零作占位除外，如
 * 「一千零一」）；十/百/千无前置数字按 1 计（「拾伍」=15）；万/亿前
 * 必须已有数字（防「万三」这类人名被误读成金额）。
 */
function parseChineseAmount(run) {
  if (!run || !/[十拾百佰千仟万萬亿億]/.test(run)) return null;
  let total = 0;
  let section = 0;
  let digit = null;
  let prevDigit = null; // 上一个字符若为数字，记其值（判相邻数字用）
  for (const ch of run) {
    if (ch in CH_DIGITS) {
      if (prevDigit !== null && prevDigit !== 0) return null; // 数字相邻＝不是金额串
      digit = CH_DIGITS[ch];
      prevDigit = digit;
    } else if (ch in CH_SMALL) {
      section += (digit === null ? 1 : digit) * CH_SMALL[ch];
      digit = null;
      prevDigit = null;
    } else if (ch in CH_BIG) {
      if (digit === null && section === 0) return null; // 万/亿前无数字
      total += (section + (digit || 0)) * CH_BIG[ch];
      section = 0;
      digit = null;
      prevDigit = null;
    }
  }
  const value = total + section + (digit || 0);
  return value > 0 ? value : null;
}

/**
 * 评估一个中文数字串：整段不合法时从左侧逐字裁剪，取最长的合法
 * 后缀作金额（姓名末字本身是数字字、与金额紧贴时靠这步分开，如
 * 「張三壹仟」→ 名「張三」＋金额「壹仟」）。hasYuanSuffix 表示串后
 * 紧跟元/圆，此时单个数字字（「五元」）也可成金额。
 * 返回 { yuan, start } 或 null（start 为金额在原串中的起始偏移）。
 */
function evalChineseRun(run, hasYuanSuffix) {
  // CA批猜读：先把形近字映射回真数字字（长度不变，下标不受影响）
  const hasTrueDigit = [...run].some((ch) => ch in CH_DIGITS);
  const mapped = [...run].map((ch) => {
    if (CH_GUESS_DIGIT[ch]) return CH_GUESS_DIGIT[ch];
    if (CH_GUESS_UNIT[ch] && hasTrueDigit) return CH_GUESS_UNIT[ch];
    return ch;
  }).join('');
  run = mapped;
  for (let start = 0; start < run.length; start++) {
    const sub = run.slice(start);
    const yuan = parseChineseAmount(sub);
    if (yuan !== null) return { yuan, start };
    if (hasYuanSuffix && sub.length === 1 && sub in CH_DIGITS && CH_DIGITS[sub] > 0) {
      return { yuan: CH_DIGITS[sub], start };
    }
  }
  return null;
}

/**
 * 在文本里找中文金额（最后一个有效候选）：
 * 候选＝中文数字串＋可选尾缀（元/圆/整、元整）。返回 { yuan, index, end } 或 null。
 */
function findChineseAmount(text) {
  CH_RUN_RE.lastIndex = 0;
  let m = null;
  let found = null;
  while ((m = CH_RUN_RE.exec(text)) !== null) {
    let end = m.index + m[0].length;
    let suffix = '';
    const tail = text.slice(end, end + 2);
    if (/^(元整|圆整|元|圆|整)/.test(tail)) { suffix = tail.match(/^(元整|圆整|元|圆|整)/)[1]; end += suffix.length; }
    const r = evalChineseRun(m[0], /^[元圆]/.test(suffix));
    if (r) found = { yuan: r.yuan, index: m.index + r.start, end };
    if (m[0] === '') CH_RUN_RE.lastIndex += 1;
  }
  return found;
}

/**
 * 扫描文本里全部金额出现（阿拉伯＋中文，按位置排序、重叠取先出现者），
 * 竖排整列拼读后按金额切笔用。返回 [{ yuan, index, end }]。
 */
function findAllAmounts(text) {
  const out = [];
  const reA = /(?:¥|￥)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:元|圆|整)?/g;
  let m = null;
  while ((m = reA.exec(text)) !== null) {
    const yuan = parseFloat(m[1].replace(/,/g, ''));
    if (yuan > 0) out.push({ yuan, index: m.index, end: m.index + m[0].length });
    if (m[0] === '') reA.lastIndex += 1;
  }
  CH_RUN_RE.lastIndex = 0;
  while ((m = CH_RUN_RE.exec(text)) !== null) {
    let end = m.index + m[0].length;
    const tail = text.slice(end, end + 2);
    const sm = /^(元整|圆整|元|圆|整)/.test(tail) ? tail.match(/^(元整|圆整|元|圆|整)/)[1] : '';
    if (sm) end += sm.length;
    const r = evalChineseRun(m[0], /^[元圆]/.test(sm));
    if (r) out.push({ yuan: r.yuan, index: m.index + r.start, end });
    if (m[0] === '') CH_RUN_RE.lastIndex += 1;
  }
  out.sort((a, b) => (a.index - b.index) || (b.end - a.end));
  const picked = [];
  let covered = -1;
  for (const c of out) {
    if (c.index >= covered) { picked.push(c); covered = c.end; }
  }
  return picked;
}

const cleanText = (s) => String(s || '').replace(/^[\s:：,，、]+|[\s:：,，、]+$/g, '');

/**
 * 把一行文本拆成 { name, amountFen, note }：
 * 取行内最后一个金额 token 作金额——阿拉伯数字（元→分，容忍千分位
 * 逗号/小数/¥/元/圆/整）与中文数字（AS批，壹仟元整→1000）两者取
 * 位置靠后者；金额之前是姓名、之后残余文本是备注（如"同学"）；
 * 没金额则整行是姓名。姓名出口前繁体转简体（zh-t2s），金额/备注不动。
 */
function splitNameAmount(text) {
  const re = /(?:¥|￥)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:元|圆|整)?/g;
  let m = null;
  let arab = null;
  while ((m = re.exec(text)) !== null) {
    arab = { num: m[1], index: m.index, end: m.index + m[0].length };
    if (m[0] === '') re.lastIndex += 1; // 防零宽死循环（理论不会发生）
  }
  const chin = findChineseAmount(text);
  let pick = null; // { amountFen, index, end }
  if (arab) {
    const numStr = arab.num.replace(/,/g, '');
    const dot = numStr.indexOf('.');
    const yuan = dot >= 0 ? numStr.slice(0, dot) : numStr;
    const cents = dot >= 0 ? (numStr.slice(dot + 1) + '00').slice(0, 2) : '00';
    pick = { amountFen: parseInt(yuan || '0', 10) * 100 + parseInt(cents, 10), index: arab.index, end: arab.end };
  }
  if (chin && (!pick || chin.end > pick.end || (chin.end === pick.end && chin.index >= pick.index))) {
    pick = { amountFen: chin.yuan * 100, index: chin.index, end: chin.end };
  }
  if (!pick) return { name: toSimplified(cleanText(text)), amountFen: null, note: '' };
  let name = cleanText(text.slice(0, pick.index));
  if (/^[\d\s.,，¥￥元圆整]+$/.test(name) || parseChineseAmount(name) === pick.amountFen / 100) {
    name = ''; // 姓名位整段就是金额 → 金额占位行，不得把金额当姓名
  }
  const note = cleanText(text.slice(pick.end));
  return { name: toSimplified(name), amountFen: pick.amountFen > 0 ? pick.amountFen : null, note };
}

/* ---------------- 版式解析（纯函数） ---------------- */

/** 按 X 区间重叠（≥50% 较窄者）把碎片聚成栏（横排左→右、竖排右→左由调用方排序） */
function clusterColumns(frags) {
  const parent = frags.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < frags.length; i++) {
    for (let j = i + 1; j < frags.length; j++) {
      if (overlapRatio(frags[i].x, frags[i].w, frags[j].x, frags[j].w) >= 0.5) {
        parent[find(i)] = find(j);
      }
    }
  }
  const colMap = new Map();
  frags.forEach((f, i) => {
    const root = find(i);
    if (!colMap.has(root)) colMap.set(root, []);
    colMap.get(root).push(f);
  });
  return [...colMap.values()].map((list) => ({
    list,
    xMin: Math.min(...list.map((f) => f.x)),
    xMax: Math.max(...list.map((f) => f.x + f.w)),
    yMin: Math.min(...list.map((f) => f.y)),
    yMax: Math.max(...list.map((f) => f.y + f.h)),
  }));
}

/**
 * 按碎片中心 X 聚类成列（BB批）：旧重叠聚类会被横跨数列的宽碎片（如纸面
 * 印刷「贺礼」被引擎连读成「贺贺贺」的宽框）链式合并掉整列，真机样例
 * 12 列被并成几大块、竖排判定随之失效（2026-10-27 留痕重放实证）。
 * 中心聚类对宽框免疫：宽框只按其中心落入一列，文字内容另行滤除。
 * 阈值随字号缩放（中位碎片高 ×0.8，下限 20px）：本例列内中心距 ≤20、
 * 列间 ≥49，两侧留足余量。
 */
function clusterByCentroid(frags) {
  if (!frags.length) return [];
  const heights = frags.map((f) => f.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 40;
  let thr = Math.max(20, medH * 0.8);
  /* BK批：阈值不得逼近列距——手写引擎的竖条碎片又高又黏（中位高 73 →
   * 阈值 58，而模板单真实列距仅 60），单链聚类必然把相邻列链成一列，
   * 几个人的名字与金额就粘成一长串（真机留痕实证：12 列只分出 7 列）。
   * 先由相邻中心距估列距（落在 25–300 的间距取中位，列内抖动多在
   * 25 以下、跨列间距即列距本体），阈值封顶为列距一半。 */
  const cxs = frags.map((f) => f.x + f.w / 2).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < cxs.length; i++) {
    const g = cxs[i] - cxs[i - 1];
    if (g >= 25 && g <= 300) gaps.push(g);
  }
  if (gaps.length >= 1) {
    gaps.sort((a, b) => a - b);
    const pitchGuess = gaps[Math.floor(gaps.length / 2)];
    if (pitchGuess > 0) thr = Math.min(thr, Math.max(20, pitchGuess * 0.5));
  }
  const sorted = [...frags].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
  const cols = [];
  for (const f of sorted) {
    const cx = f.x + f.w / 2;
    const last = cols[cols.length - 1];
    if (last && cx - last.cxMax <= thr) {
      last.list.push(f);
      last.cxMax = cx;
    } else {
      cols.push({ list: [f], cxMin: cx, cxMax: cx });
    }
  }
  return cols.map((c) => ({
    list: c.list,
    xMin: Math.min(...c.list.map((f) => f.x)),
    xMax: Math.max(...c.list.map((f) => f.x + f.w)),
    yMin: Math.min(...c.list.map((f) => f.y)),
    yMax: Math.max(...c.list.map((f) => f.y + f.h)),
    cxMin: c.cxMin,
    cxMax: c.cxMax,
  }));
}

/**
 * 跨列宽碎片按字拆分（BH批）：引擎会把相邻两列的同行字连读成一个宽框
 * （真机留痕实证：印刷引擎把第 3 列「成」与第 4 列「侯」连成「成侯」
 * 一框，宽 164px≈两列距——后续任何聚类都拆不开，侯就此串列；纸面印刷
 * 「贺礼」连读宽框同理）。竖排定界改按列带：先由首轮中心聚类的列中心
 * 估出列距（相邻列中心距中位数），宽 >1.3 列距且 ≥2 字的碎片按字均分
 * 子框，逐字生成新碎片——每个字落回自己那一列的带里，再重新聚类。
 * 单列内的连读（如「杨力」宽 95<1.3 列距）不动，拼读结果不变。
 */
function splitWideFragments(frags, centroidCols) {
  const centers = (centroidCols || [])
    .map((c) => (c.cxMin + c.cxMax) / 2)
    .sort((a, b) => a - b);
  if (centers.length < 2) return frags;
  const gaps = [];
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
  gaps.sort((a, b) => a - b);
  const pitch = gaps[Math.floor(gaps.length / 2)];
  if (!pitch || pitch <= 0) return frags;
  const out = [];
  for (const f of frags) {
    const chars = [...String(f.text)];
    if (chars.length >= 2 && f.w > pitch * 1.3) {
      const subW = f.w / chars.length;
      chars.forEach((ch, i) => {
        out.push({ ...f, text: ch, x: f.x + subW * i, w: subW, cx: f.x + subW * i + subW / 2 });
      });
    } else {
      out.push(f);
    }
  }
  return out;
}

/**
 * 模板印刷物剔除（BK批）：印刷模板礼单每列同一位置印着同样的装饰/纹样
 * （真机留痕：心形花纹被手写引擎在 4 列同高处读成「望木」），会被当成
 * 姓名的一部分粘进名字。判据：同一文本（≥2 字、不含数字与金额字）在
 * ≥3 列出现且纵向位置相近（中心 Y 差 ≤45）——真姓名不可能三列同文同高。
 * 只剔这种跨列重复的印刷物，列内独有内容一律不动。
 */
function dropRepeatedPrintFrags(frags, cols) {
  const byText = new Map();
  for (const col of cols) {
    for (const f of col.list) {
      const t = String(f.text || '').trim();
      if (t.length < 2) continue;
      if (/[0-9]/.test(t)) continue;
      if (/[佰拾仟万亿两元角分整圓]/.test(t)) continue;
      if (!byText.has(t)) byText.set(t, []);
      byText.get(t).push({ f, col, cy: f.y + f.h / 2 });
    }
  }
  const drop = new Set();
  for (const [, items] of byText) {
    const colSet = new Set(items.map((i) => i.col));
    if (colSet.size < 3) continue;
    const cys = items.map((i) => i.cy).sort((a, b) => a - b);
    const med = cys[Math.floor(cys.length / 2)];
    if (items.every((i) => Math.abs(i.cy - med) <= 45)) items.forEach((i) => drop.add(i.f));
  }
  if (!drop.size) return frags;
  return frags.filter((f) => !drop.has(f));
}

/** 竖排判定（AS批立、BB批改 ②）：① 多数文本框高大于宽（整列竖条）；或
 * ② 按中心聚类后，多数列呈"高瘦"形：列内中心 X 跨度加中位字宽仍远小于
 * 列高（≥2.5×），且每列至少 3 个碎片（单字逐个成框竖排成列的情形）。
 * 横排文档中心聚类后多为少数宽列或矮列，不会误触 ②。
 */
function detectVertical(frags, columns, centroidCols) {
  const tall = frags.filter((f) => f.h > f.w).length;
  if (tall > frags.length / 2) return true;
  const cols = Array.isArray(centroidCols) && centroidCols.length ? centroidCols : columns;
  if (!cols || cols.length < 2) return false;
  const widths = frags.map((f) => f.w).filter((w) => w > 0).sort((a, b) => a - b);
  const medW = widths.length ? widths[Math.floor(widths.length / 2)] : 40;
  const vertCols = cols.filter((c) => {
    if (c.list.length < 3) return false;
    const colH = c.yMax - c.yMin;
    const colW = Math.max(1, (c.cxMax != null ? c.cxMax - c.cxMin : c.xMax - c.xMin) + medW);
    if (colH < 2.5 * colW) return false;
    /* 防横排表格误触：竖排列内碎片应近方形/竖长（字框），横排表格的
     * 单元格是宽框——列内中位宽 > 1.3×中位高则不算竖排列（AS 旧守卫） */
    const ws = c.list.map((f) => f.w).sort((a, b) => a - b);
    const hs = c.list.map((f) => f.h).sort((a, b) => a - b);
    const mW = ws[Math.floor(ws.length / 2)];
    const mH = hs[Math.floor(hs.length / 2)];
    return mW <= mH * 1.3;
  });
  return vertCols.length >= cols.length * 0.6;
}

/** 竖排整列拼读文本按金额切笔：每笔止于一个金额，金额后残余并入该笔备注 */
function splitColumnText(text) {
  const amounts = findAllAmounts(text);
  if (!amounts.length) {
    const { name, amountFen, note } = splitNameAmount(text);
    return [{ name, amountFen, note, raw: text }];
  }
  const rows = [];
  let prev = 0;
  amounts.forEach((a, i) => {
    const seg = text.slice(prev, a.end);
    const r = splitNameAmount(seg);
    rows.push({ name: r.name, amountFen: r.amountFen, note: r.note, raw: seg });
    prev = a.end;
    if (i === amounts.length - 1) {
      const tail = cleanText(text.slice(prev));
      if (tail) rows[rows.length - 1].note = rows[rows.length - 1].note
        ? `${rows[rows.length - 1].note} ${tail}` : tail;
    }
  });
  return rows;
}

/* ---------------- 竖排金额误读救援（BB批） ----------------
 * 真机留痕实证：竖排手写大写金额被两家引擎系统性误读——贰→式、佰→伯/们/
 * 的/永/旧/日/修、整→单个拉丁字母，且佰、元常整字丢失（如「伍 m」实为
 * 伍佰元整、「式伯元」实为贰佰元）。标准中文金额式认不出这类尾串，整列
 * 金额全空。救援口径（仅竖排列、标准解析无金额时启用）：
 * 从列尾回扫「金额字母表」字符（数字/佰位误读字/元/整与拉丁碎字），
 * 尾串里第一个数字字定百位：礼单大写金额以佰为常态量级，尾串含佰位字、
 * 或含元、或长度 ≥2 时按 ×100 解码；再把尾串头部的非数字字还给姓名
 * （防姓名末字是永/的等被误吞）。尾串含拾/仟/万（高阶金额）不救，
 * 交回标准路径/留空待用户在核对页补——宁缺毋滥。
 * 姓名顺带清理：去掉标点（、，,。·）与拉丁碎字（引擎杂讯）。 */
/* 他→5（BH批）：手写「伍」与「他」同为亻旁、形近，两份真机留痕里金额位
 * 的伍都被认成他（「E峰他o元」实为伍佰元整）。本表只在金额尾串语境
 * 使用（decodeVerticalAmountTail 从列尾回扫、且须有佰位/元佐证才解码），
 * 姓名中的他不受影响——尾串之外的字根本不进本表。 */
const VERT_NUM = { 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 式: 2, 他: 5 };
const VERT_BAI = new Set(['佰', '伯', '们', '的', '永', '旧', '日', '修', '花']);
const VERT_YUAN = new Set(['元', '圆', '不']);
const VERT_HIGH = new Set(['拾', '仟', '万', '萬', '亿']);
function isVertAmountChar(ch) {
  return VERT_NUM[ch] != null || VERT_BAI.has(ch) || VERT_YUAN.has(ch)
    || ch === '整' || ch === '正' || /[A-Za-z0-9]/.test(ch);
}
function decodeVerticalAmountTail(text) {
  let i = text.length - 1;
  while (i >= 0 && isVertAmountChar(text[i])) i--;
  let tail = text.slice(i + 1);
  if (!tail) return null;
  if ([...tail].some((ch) => VERT_HIGH.has(ch))) return null;
  const firstNum = [...tail].findIndex((ch) => VERT_NUM[ch] != null);
  if (firstNum < 0) return null;
  tail = tail.slice(firstNum);
  const name = text.slice(0, text.length - tail.length)
    .replace(/[、，,。·\s]/g, '').replace(/[A-Za-z0-9]/g, '');
  if (!name) return null;
  const digit = VERT_NUM[tail[0]];
  const hasBai = [...tail].some((ch) => VERT_BAI.has(ch));
  const hasYuan = [...tail].some((ch) => VERT_YUAN.has(ch));
  if (!hasBai && !hasYuan && tail.length < 2) return null;
  return { name, amountFen: digit * 100 * 100 };
}

/**
 * 竖排解析：按中心 X 分列（跨列绝不串）、列序左到右（冻结契约：左列→右列，
 * 与横排同向；真机样例第 1 条正是「張」即最左列首字）、列内 Y 自上
 * 而下拼读成笔。红纸礼单每列中段的纸面印刷字「贺礼/賀禮」、白事礼单的
 * 「奠仪/奠儀」都不是内容，
 * 拼读后先滤除再拆姓名/金额（样例图 12 列每列都有）。
 * 标准拆分整列无金额时走 decodeVerticalAmountTail 救援（BB批）。
 */

/* BI批：竖排姓名按字位构建＋姓名库纠错（用户 2026-10-27 定）。
 * 标记行（贺礼/奠仪印刷行）在全页处于同一纵向带，先定带再逐列取标记，
 * 免得姓名里的「礼」字被误当标记截断姓名。 */
const MARKER_CHARS = new Set([...'贺賀礼禮奠儀']);
function isMarkerFrag(f) {
  const t = String(f.text || '').replace(/[^一-龥]/g, '');
  return t.length > 0 && [...t].every((c) => MARKER_CHARS.has(c));
}
function estimateColumnPitch(cols) {
  const diffs = [];
  for (const col of cols) {
    const items = [...col.list].sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      const d = items[i].y - items[i - 1].y;
      if (d >= 30 && d <= 220) diffs.push(d);
    }
  }
  if (!diffs.length) return 80;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}
function markerBandY(cols) {
  const ys = [];
  for (const col of cols) {
    const items = [...col.list].sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (isMarkerFrag(items[i])) ys.push(items[i].y);
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)];
}
function columnMarkerIdx(items, bandY, pitch) {
  if (bandY == null) return -1;
  for (let i = 1; i < items.length; i++) {
    if (isMarkerFrag(items[i]) && Math.abs(items[i].y - bandY) <= pitch) return i;
  }
  return -1;
}
function expectedTrailingFree(cols, bandY, pitch) {
  const frees = [];
  for (const col of cols) {
    const items = [...col.list].sort((a, b) => a.y - b.y);
    const idx = columnMarkerIdx(items, bandY, pitch);
    if (idx < 1) continue;
    const lastBottom = Math.max(...items.slice(0, idx).map((f) => f.y + f.h));
    frees.push(items[idx].y - lastBottom);
  }
  if (!frees.length) return 50;
  frees.sort((a, b) => a - b);
  return frees[Math.floor(frees.length / 2)];
}
/* 姓名纠错：姓位不在百家姓且形近表有真姓才换；名位字本身不是姓名用字
 * 且形近表有名字字候选才换，候选按形近序位、与同名其他字的性别池契合、
 * 常见搭配打分。已是常见姓名用字的永不改（把对的改错比认错更糟）。 */
function snapName(name) {
  const chars = [...String(name || '')];
  if (!chars.length) return name;
  const DB = NAME_DB;
  if (chars[0] !== '□' && !DB.SURNAMES.has(chars[0]) && DB.CONFUSION[chars[0]]) {
    const cand = DB.CONFUSION[chars[0]].find((c) => DB.SURNAMES.has(c));
    if (cand) chars[0] = cand;
  }
  const gScore = chars.slice(1).reduce((sum, c) => sum + DB.genderOf(c), 0);
  for (let i = 1; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '□' || DB.isNameChar(ch) || !DB.CONFUSION[ch]) continue;
    const cands = DB.CONFUSION[ch].filter((c) => DB.MALE_CHARS.has(c) || DB.FEMALE_CHARS.has(c) || DB.NEUTRAL_CHARS.has(c));
    if (!cands.length) continue;
    let best = null;
    let bestScore = -Infinity;
    cands.forEach((c, idx) => {
      let sc = -idx;
      const g = DB.genderOf(c);
      if (gScore > 0 && g === 1) sc += 2;
      if (gScore < 0 && g === -1) sc += 2;
      if (DB.COLLOCATIONS.has(chars[i - 1] + c)) sc += 2;
      if (i + 1 < chars.length && DB.COLLOCATIONS.has(c + chars[i + 1])) sc += 2;
      if (sc > bestScore) { bestScore = sc; best = c; }
    });
    if (best) chars[i] = best;
  }
  return chars.join('');
}
/* 按字位构建竖排姓名（保字数，只补占位、绝不少字）：
 * 纯杂讯碎片（拉丁/符号）本身占一个字位，记「□」；
 * 并框碎片按框高折算字位，少读的字在杂讯处补「□」；
 * 名字末字到标记行的空隙比全场中位多出近一字位，尾巴少了字，末尾补「□」。 */
function buildVerticalName(items, markerIdx, pitch, expFree) {
  const nameFrags = items.slice(0, markerIdx);
  if (!nameFrags.length) return '';
  const pitchChar = pitch * 0.88;
  let name = '';
  for (const f of nameFrags) {
    const raw = String(f.text || '');
    const cleaned = raw.replace(/[^一-龥]/g, '');
    if (!cleaned) { name += '□'; continue; }
    let seg = cleaned;
    if (f.h >= pitchChar * 1.4) {
      const slots = Math.max(cleaned.length, Math.round(f.h / pitchChar));
      const missing = slots - cleaned.length;
      if (missing > 0) {
        const junkAt = raw.search(/[^一-龥]/);
        let pos = cleaned.length;
        if (junkAt >= 0) {
          pos = Math.min([...raw.slice(0, junkAt)].filter((c) => /[一-龥]/.test(c)).length, cleaned.length);
        }
        seg = cleaned.slice(0, pos) + '□'.repeat(missing) + cleaned.slice(pos);
      }
    }
    name += seg;
  }
  const lastBottom = Math.max(...nameFrags.map((f) => f.y + f.h));
  const free = items[markerIdx].y - lastBottom;
  let missing = 0;
  if (free - expFree >= pitch * 0.6) missing = Math.round((free - expFree) / pitch);
  if (nameFrags.length === 1) missing = Math.min(missing, 1);
  /* 姓名长度规律（用户 2026-10-27 定）：99% ≤3 字、极个别 4 字，
   * 占位补字最多补到 4 字为止（BK批，原上限 5 改 4） */
  while (missing > 0 && name.length < 4) { name += '□'; missing -= 1; }
  return snapName(name);
}

function parseVertical(frags, columns) {
  /* BH批：列序按列中心排，不按 xMin——跨列宽框（如印刷「贺贺贺贺贺」
   * 宽 403）会把所在列的 xMin 拖到左邻列之前，真机留痕里第 9 列被拖到
   * 第 7 列之前、7/8/9 三列轮转出错。中心由聚类 cxMin/cxMax 取中点，
   * 宽框只占一列中心、拖不动。 */
  const centerOf = (c) => (c.cxMin != null && c.cxMax != null ? (c.cxMin + c.cxMax) / 2 : c.xMin);
  const cols = [...columns].sort((a, b) => centerOf(a) - centerOf(b));
  const pitch = estimateColumnPitch(cols);
  const bandY = markerBandY(cols);
  const expFree = expectedTrailingFree(cols, bandY, pitch);
  const rows = [];
  for (const col of cols) {
    const sortedItems = [...col.list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const markerIdx = columnMarkerIdx(sortedItems, bandY, pitch);
    const builtName = markerIdx > 0 ? buildVerticalName(sortedItems, markerIdx, pitch, expFree) : '';
    let text = [...col.list].sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map((f) => f.text).join('')
      .replace(/賀禮|贺礼|奠儀|奠仪/g, '');
    /* BB批：成对标记滤除后仍会残留单字「贺/礼」——纸面印刷标记被引擎
     * 跨列连读（如「贺贺贺」宽框）后按中心落进某一列、或同列的贺被分到
     * 邻列，只剩单字。列首字保留（贺姓），其余位置的单字贺/礼按标记
     * 残渣清除。 */
    if (text.length > 1) text = text[0] + text.slice(1).replace(/[贺賀礼禮]/g, '');
    if (!text) continue;
    /* 金额：整列只有一个金额位时先走误读救援（标准式会把「伍元」认成
     * 5 元、把「9 元」认成 9 元，反而挡住救援）；两个以上金额位（一列
     * 多笔）仍走标准切分。救援不成再回标准路径。 */
    if (findAllAmounts(text).length < 2) {
      const rescued = decodeVerticalAmountTail(text);
      if (rescued) {
        /* 姓名出口与标准路径一致：繁转简（zh-t2s） */
        rows.push({ name: toSimplified(builtName || rescued.name), amountFen: rescued.amountFen, note: '', raw: text });
        continue;
      }
    }
    const parts = splitColumnText(text);
    const colRows = [];
    for (const r of parts) {
      /* 竖排姓名净化：去掉拉丁碎字与标点（引擎杂讯，如「E峰」「刘,x以」） */
      const cleanedName = String(r.name || '').replace(/[A-Za-z0-9、，,。·\s]/g, '');
      /* BK批：模板列一笔里常有两份金额证据（手写大写条＋底部阿拉伯数字），
       * 标准切分会按金额个数把一笔拆成两行，第二行的"姓名"其实是金额条
       * 残字（无/住/佰类，不含任何姓名用字）。这类残段并回上一行，金额以
       * 后出现的为准（底部数字是最终证据）。真·一列多笔的姓名含姓名用字，
       * 不会误并。 */
      const nameLike = [...cleanedName].some((ch) => NAME_DB.isNameChar(ch) || NAME_DB.SURNAMES.has(ch));
      if (colRows.length && (!cleanedName || !nameLike)) {
        if (r.amountFen != null) colRows[colRows.length - 1].amountFen = r.amountFen;
        continue;
      }
      colRows.push({ ...r, name: cleanedName });
    }
    for (const r of colRows) {
      /* BI批：整列单笔时姓名改用按字位构建＋姓名库纠错的结果 */
      rows.push(colRows.length === 1 && builtName ? { ...r, name: toSimplified(builtName) } : r);
    }
  }
  return rows;
}

/**
 * 横排解析：
 * 分栏：碎片按 X 区间重叠聚类成栏，栏从左到右；
 * 栏内分行：同一水平带（Y 重叠 ≥35% 较矮者，或中心线距 ≤ 半个较矮框高）
 * 的碎片合为一笔——姓名与金额同行不得拆成两笔（AS批，修 12 拆 21）；
 * 行内碎片按 X 从左到右拼成一行文本再拆姓名/金额。
 * 合并恢复：某栏全部行"只有金额"时，先按窄守卫（与前一栏同数纯姓名行
 * 按序合并）；不满足再按 Y 就近把金额配给前一栏最近的无金额姓名行，
 * 配不上的金额行保留为空姓名占位行（不丢行）。
 */
function parseHorizontal(frags, columns) {
  const cols = [...columns].sort((a, b) => a.xMin - b.xMin);
  const sameBand = (f, ln) => {
    const overlap = overlapRatio(f.y, f.h, ln.yMin, ln.yMax - ln.yMin);
    if (overlap >= 0.35) return true;
    const fcy = f.y + f.h / 2;
    const lcy = (ln.yMin + ln.yMax) / 2;
    return Math.abs(fcy - lcy) <= 0.5 * Math.max(1, Math.min(f.h, ln.yMax - ln.yMin));
  };
  const colRows = cols.map(({ list }) => {
    const sorted = [...list].sort((a, b) => (a.cy - b.cy) || (a.x - b.x));
    const lines = [];
    for (const f of sorted) {
      const line = lines.find((ln) => sameBand(f, ln));
      if (line) {
        line.frags.push(f);
        line.yMin = Math.min(line.yMin, f.y);
        line.yMax = Math.max(line.yMax, f.y + f.h);
      } else {
        lines.push({ frags: [f], yMin: f.y, yMax: f.y + f.h });
      }
    }
    lines.sort((a, b) => a.yMin - b.yMin);
    return lines.map((ln) => {
      const raw = [...ln.frags].sort((a, b) => a.x - b.x).map((f) => f.text).join('');
      const { name, amountFen, note } = splitNameAmount(raw);
      return { name, amountFen, note, raw, _y0: ln.yMin, _y1: ln.yMax };
    });
  });

  const merged = [];
  for (let c = 0; c < colRows.length; c++) {
    const rows = colRows[c];
    const prev = merged[merged.length - 1];
    const isAmountCol = rows.length > 0 && rows.every((r) => !r.name && r.amountFen !== null);
    if (prev && isAmountCol && rows.length === prev.length
      && prev.every((r) => r.name && r.amountFen === null)) {
      // 窄守卫：按序两两合并
      for (let i = 0; i < rows.length; i++) {
        prev[i] = {
          ...prev[i],
          amountFen: rows[i].amountFen,
          note: prev[i].note || rows[i].note || '',
          raw: `${prev[i].raw} ${rows[i].raw}`.trim(),
        };
      }
    } else if (prev && isAmountCol
      && prev.filter((r) => r.name && r.amountFen === null).length >= Math.ceil(prev.length / 2)) {
      // Y 就近配对：金额行配给中心线最近的无金额姓名行；配不上保留占位行
      const heights = prev.map((r) => r._y1 - r._y0).filter((h) => h > 0);
      const medH = heights.length ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] : 30;
      const leftovers = [];
      for (const ar of rows) {
        const acy = (ar._y0 + ar._y1) / 2;
        let best = null;
        let bestD = Infinity;
        for (const pr of prev) {
          if (!pr.name || pr.amountFen !== null) continue;
          const d = Math.abs((pr._y0 + pr._y1) / 2 - acy);
          if (d < bestD) { bestD = d; best = pr; }
        }
        if (best && bestD <= 1.5 * medH) {
          best.amountFen = ar.amountFen;
          best.note = best.note || ar.note || '';
          best.raw = `${best.raw} ${ar.raw}`.trim();
        } else {
          leftovers.push(ar);
        }
      }
      if (leftovers.length) merged.push(leftovers);
    } else {
      merged.push(rows);
    }
  }
  // 欄序即行序（冻结契约：左栏自上而下再右栏），只剥内部几何字段
  return merged.flat().map(({ _y0, _y1, ...row }) => row);
}

/**
 * TextDetections → rows（与 MockOCR 同形）。
 * 先判竖/横排：竖排走 parseVertical（列内成笔、跨列不串，AS批），
 * 横排走 parseHorizontal（分栏＋同带合并）。
 */
function parseDetections(detections) {
  const frags = (Array.isArray(detections) ? detections : [])
    .map((d) => {
      const text = String((d && d.DetectedText) || '').trim();
      if (!text) return null;
      const b = bboxOf(d);
      return { text, ...b, cy: b.y + b.h / 2 };
    })
    .filter(Boolean);
  if (!frags.length) return [];
  const columns = clusterColumns(frags);
  /* BB批：竖排走中心聚类（对横跨数列的宽框免疫）；横排沿用重叠聚类不变 */
  const centroidCols = clusterByCentroid(frags);
  if (!detectVertical(frags, columns, centroidCols)) return guardRowNames(parseHorizontal(frags, columns));
  /* BH批：竖排先把跨列宽碎片按字拆回各自列带，再重新聚类成列 */
  const split = splitWideFragments(frags, centroidCols);
  /* BK批：剔除跨列重复的模板印刷物（花纹类），再聚类成列 */
  const cleaned = dropRepeatedPrintFrags(split, clusterByCentroid(split));
  return guardRowNames(parseVertical(cleaned, clusterByCentroid(cleaned)));
}

/* 姓名长度硬顶（BK批，用户定的规律：99% ≤3 字、极个别 4 字）：
 * 任何路径拼出的名字超过 4 字必是拼装事故——按姓位锚点截回 ≤4 字
 * （找得到的第一个真姓起算），绝不把一长串端给用户。 */
function guardRowNames(rows) {
  const DB = NAME_DB;
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const name = String((r && r.name) || '');
    if (name.length <= 4) return r;
    let start = -1;
    for (let i = 0; i < name.length; i++) {
      if (DB.SURNAMES.has(name[i])) { start = i; break; }
    }
    const cut = start >= 0 ? name.slice(start, start + 4) : name.slice(0, 4);
    return { ...r, name: cut };
  });
}

/* ---------------- 列模式（BY批，用户定：红线分列＋数数配对） ----------------
 * 适用：市面横置纸质礼单本（印好红线表格，一列一人：上姓名、下金额）。
 * 原理：先从已转正图的像素里找红线网格（自上而下定格子，不猜列），
 * 再把碎片按中心横坐标归列；姓名列从左数、金额列从左数，按序号配对
 * （手写左右漂移不改变左右顺序，漂移不串列——这是按横坐标重叠配对
 * 做不到的）。花纹图案忽略：浅粉花纹进不了强红阈值，边角花纹不成
 * 行、形不成均匀间距，过不了峰值＋均匀性两道门；模板印刷字（贺礼类）
 * 仍走跨列重复剔除。网格不自信（峰太少、间距不均）一律回落现有流程，
 * 绝不强行用网格；数量对不上时回落列内配对并把 mismatch 写进留痕。
 * 注意：本分支只要像素（已转正图），不新增腾讯调用，不增加费用。 */
function detectGridFromJpeg(imageBase64) {
  let jpeg;
  try { jpeg = require('jpeg-js'); } catch (e) { return null; }
  let img;
  try {
    img = jpeg.decode(Buffer.from(imageBase64, 'base64'), { useTArray: true, maxMemoryUsageInMB: 256 });
  } catch (e) { return null; }
  const W = img.width, H = img.height, data = img.data;
  if (!W || !H || !data) return null;
  const isRed = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return r > 140 && (r - g) > 50 && (r - b) > 50;
  };
  const proj = new Array(W).fill(0);
  for (let y = 0; y < H; y++) {
    const rowOff = y * W * 4;
    for (let x = 0; x < W; x++) if (isRed(rowOff + x * 4)) proj[x]++;
  }
  const sm = proj.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(W - 1, i + 2); k++) { s += proj[k]; n++; }
    return s / n;
  });
  const max = Math.max(...sm);
  if (!max) return null;
  const minSep = Math.max(30, Math.round(W * 0.02));
  const peaks = [];
  for (let i = 2; i < W - 2; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > max * 0.4) {
      if (!peaks.length || i - peaks[peaks.length - 1].pos > minSep) peaks.push({ pos: i, val: sm[i] });
      else if (sm[i] > peaks[peaks.length - 1].val) peaks[peaks.length - 1] = { pos: i, val: sm[i] };
    }
  }
  if (peaks.length < 5) return null;
  const divs = peaks.map((p) => p.pos);
  const gaps = [];
  for (let i = 1; i < divs.length; i++) gaps.push(divs[i] - divs[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  if (!med) return null;
  const regular = gaps.filter((g) => g >= med * 0.7 && g <= med * 1.4).length;
  if (regular < gaps.length * 0.7) return null;
  // 宽段拆分：任一段 ≈2 倍中位间距时，说明中间一条分界线被边角花纹盖住
  // 或照片裁切（如横置本左缘首段 290px），按中位间距在段内补线；切开宽列也
  // 安全（空子列被跳过，名/金额仍按序号配对），循环补到全部段 ≤1.6 倍中位
  for (let i = 0; i < divs.length - 1; i++) {
    while (divs[i + 1] - divs[i] > med * 1.6) {
      divs.splice(i + 1, 0, divs[i] + med);
      if (divs.length > 40) break;
    }
  }
  const columns = [];
  for (let i = 1; i < divs.length; i++) columns.push({ x0: divs[i - 1], x1: divs[i] });
  if (columns.length < 3) return null;
  return { dividers: divs, columns, medianGap: med };
}

/* 网格列模式解析：detections（已选引擎的碎片）＋网格 → 行。
 * 姓名序列、金额序列各按列序排，按序号配对；数量不等回落列内配对。 */
function parseWithGrid(detections, grid) {
  const frags = (Array.isArray(detections) ? detections : [])
    .map((d) => {
      const text = String((d && d.DetectedText) || '').trim();
      if (!text) return null;
      const b = bboxOf(d);
      return { text, ...b, cy: b.y + b.h / 2 };
    })
    .filter(Boolean);
  if (!frags.length) return { rows: [], paired: false, mismatch: null };
  const cols = grid.columns.map((c) => ({ x0: c.x0, x1: c.x1, xMin: c.x0, cxMin: c.x0, cxMax: c.x1, list: [] }));
  for (const f of frags) {
    const cx = f.x + f.w / 2;
    let col = cols.find((c) => cx >= c.x0 && cx < c.x1);
    if (!col && cx >= cols[cols.length - 1].x1) col = cols[cols.length - 1]; // 右缘出框一点也算入末列
    if (col) col.list.push(f);
  }
  const inGrid = frags.filter((f) => cols.some((c) => c.list.includes(f)));
  const cleaned = dropRepeatedPrintFrags(inGrid, cols);
  const kept = new Set(cleaned);
  for (const c of cols) c.list = c.list.filter((f) => kept.has(f));
  const names = [];
  const amounts = [];
  for (const c of cols) {
    const sorted = [...c.list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    // 拼读：碎片直接拼接（中文大写金额不断字），但数字-数字边界须空格隔开，
    // 否则漂移到同列的两个金额会粘成一个数（如 800＋1000 → 8001000）
    let joined = '';
    for (const f of sorted) {
      if (joined && /[0-9]$/.test(joined) && /^[0-9]/.test(f.text)) joined += ' ';
      joined += f.text;
    }
    const text = joined.replace(/賀禮|贺礼|奠儀|奠仪/g, '');
    if (!text) continue;
    const found = findAllAmounts(text);
    let nameText = text;
    if (found.length) {
      for (let i = found.length - 1; i >= 0; i--) nameText = nameText.slice(0, found[i].index) + nameText.slice(found[i].end);
      for (const a of found) amounts.push(Math.round(a.yuan * 100));
    }
    let nm = nameText;
    if (nm.length > 1) nm = nm[0] + nm.slice(1).replace(/[贺賀礼禮]/g, '');
    nm = nm.replace(/[A-Za-z0-9、，,。·\s]/g, '');
    if (nm) names.push(nm);
  }
  if (names.length && names.length === amounts.length) {
    const rows = names.map((n, i) => ({ name: toSimplified(snapName(n)), amountFen: amounts[i], note: '', raw: n }));
    return { rows: guardRowNames(rows), paired: true, mismatch: null };
  }
  const fallback = guardRowNames(parseVertical(cleaned, cols));
  return { rows: fallback, paired: false, mismatch: { names: names.length, amounts: amounts.length } };
}

/* ---------------- 识别质量评估（AS批质量门，纯函数） ----------------
 * 阈值常量（摘要列明）：平均置信度 < 70 判低（腾讯 Confidence 0–100，
 * 至少半数碎片带该字段才启用）；碎片中单字碎片占比 > 60%（且碎片 ≥4）
 * 判碎片化；任一碎片含 ≥4 个连续拉丁字母，或全文拉丁字母占比 ≥25%
 * （且拉丁字符 ≥4）判拉丁乱码。任一命中即 bad（质量差）。
 * score 越高越好，用于印刷/手写两份结果取优。 */
const QUALITY_MIN_CONFIDENCE = 70;
const QUALITY_SINGLE_CHAR_RATIO = 0.6;
const QUALITY_LATIN_RUN = 4;

function assessQuality(detections) {
  const dets = Array.isArray(detections) ? detections : [];
  const frags = dets
    .map((d) => ({
      text: String((d && d.DetectedText) || '').trim(),
      conf: d && typeof d.Confidence === 'number' ? d.Confidence : null,
    }))
    .filter((f) => f.text);
  const rows = parseDetections(dets);
  const reasons = [];
  if (!frags.length) return { bad: true, score: -100, reasons: ['empty'], rows };

  const allText = frags.map((f) => f.text).join('');
  const latinChars = (allText.match(/[A-Za-z]/g) || []).length;
  const hasLatinRun = frags.some((f) => new RegExp(`[A-Za-z]{${QUALITY_LATIN_RUN},}`).test(f.text));
  const latinGibberish = hasLatinRun || (latinChars >= QUALITY_LATIN_RUN && latinChars / Math.max(1, allText.length) >= 0.25);
  if (latinGibberish) reasons.push('latin-gibberish');

  const confs = frags.filter((f) => f.conf !== null).map((f) => f.conf);
  const confKnown = confs.length >= Math.ceil(frags.length / 2);
  const avgConf = confKnown ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  if (confKnown && avgConf < QUALITY_MIN_CONFIDENCE) reasons.push('low-confidence');

  const singleChar = frags.filter((f) => f.text.length === 1).length;
  const singleRatio = frags.length ? singleChar / frags.length : 0;
  if (frags.length >= 4 && singleRatio > QUALITY_SINGLE_CHAR_RATIO) reasons.push('single-char-fragments');

  const withAmount = rows.filter((r) => r.amountFen !== null).length;
  const amountRatio = rows.length ? withAmount / rows.length : 0;
  /* BM批：计分按"像姓名的程度"——姓位是真姓、名字字落在姓名用字池才
   * 计分。旧版按名字总字数计分，手写引擎的垃圾长串（那来河无类）反而
   * 靠字多刷分赢过印刷（升学宴真机实证）。 */
  let plausibleChars = 0;
  let surnameRows = 0;
  for (const r of rows) {
    const nm = String(r.name || '');
    if (!nm) continue;
    if (NAME_DB.SURNAMES.has(nm[0]) || nm[0] === '□') surnameRows += 1;
    for (const ch of nm) {
      if (NAME_DB.isNameChar(ch) || NAME_DB.SURNAMES.has(ch) || ch === '□') plausibleChars += 1;
    }
  }
  const surnameRatio = rows.length ? surnameRows / rows.length : 0;
  let score = 0;
  if (confKnown) score += (avgConf - 50) * 0.6;
  score += amountRatio * 20;
  score += Math.min(plausibleChars, 20) * 0.5;
  score += surnameRatio * 15;
  if (latinGibberish) score -= 45;
  if (reasons.includes('single-char-fragments')) score -= 25;
  if (!rows.length) score -= 100;
  return { bad: reasons.length > 0, score, reasons, rows, avgConf };
}

/* ---------------- 照片转正（BL批＋BZ批四方向） ----------------
 * 横置礼单被竖着拍时，整页字转了 90°：引擎碎片全是横向长条、混读成串，
 * 解析层转坐标救不回（离线实证：行拆开了但金额几乎全丢）。正解是把
 * 图片像素转正后重新过引擎，用户不用保证每次正着拍。
 * 检测（纯几何＋质量分双条件，防误伤正常横排文档）：碎片 ≥6、中位宽
 * >中位高、宽条（宽>高×1.2）占比 ≥50%，且首轮质量分 <55 才怀疑转置。
 * BZ批四方向：转置怀疑 → 顺时针 90°、逆时针 90°；首轮差（分 <55 或
 * 没认出）→ 再加 180°。横排本倒过来时旧触发器会误判为转置（横条特征），
 * 但旧代码只试 90° 所以救不回；竖排本倒过来时触发器完全不认——新逻辑
 * 是“首轮差就试 180°”，两种倒置都覆盖。好照片（分 ≥55 且有行）不试
 * 任何方向，开销与原来相同；最差一张多试 3 个方向（各双调 2 次）。
 * 转正用纯 JS 的 jpeg-js（api 新增依赖）；解码失败/超大图/依赖缺失时
 * 静默跳过，保持原结果——转正只是加分项，绝不让识别因此失败。 */
const ROTATE_MAX_PIXELS = 8000000;
const ROTATE_SUSPECT_SCORE = 55;

/* BZ批：根据首轮结果定试转方向（纯函数，便于测试）。
 * suspect＝转置怀疑（横长条＋低分）；score＝首轮质量分；rowsEmpty＝首轮无行。 */
function pickRotationDirs({ suspect, score, rowsEmpty }) {
  const dirs = [];
  if (suspect) dirs.push('cw', 'ccw');
  if (typeof score === 'number' && score < ROTATE_SUSPECT_SCORE) dirs.push('r180');
  else if (rowsEmpty) dirs.push('r180');
  return dirs;
}

function rotationSuspect(detections, score) {
  if (typeof score === 'number' && score >= ROTATE_SUSPECT_SCORE) return false;
  const frags = (Array.isArray(detections) ? detections : [])
    .map((d) => bboxOf(d))
    .filter((b) => b && b.w > 0 && b.h > 0);
  if (frags.length < 6) return false;
  const med = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const medW = med(frags.map((f) => f.w));
  const medH = med(frags.map((f) => f.h));
  if (!(medW > medH)) return false;
  const wide = frags.filter((f) => f.w > f.h * 1.2).length;
  return wide >= frags.length * 0.5;
}

function rotateJpegBase64(imageBase64, dir) {
  let jpeg;
  try { jpeg = require('jpeg-js'); } catch (e) { return null; }
  try {
    const src = jpeg.decode(Buffer.from(imageBase64, 'base64'), { useTArray: true, maxMemoryUsageInMB: 256 });
    if (!src || !src.width || !src.height || src.width * src.height > ROTATE_MAX_PIXELS) return null;
    const W = src.width; const H = src.height; const data = src.data;
    const out = Buffer.alloc(W * H * 4);
    // BZ批：r180 宽高不变（180° 对调）；cw/ccw 宽高互换
    const outW = dir === 'r180' ? W : H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4;
        /* cw：原图逆时针转置 → 顺时针转正；ccw 反之；r180：整张倒置 */
        let dx; let dy;
        if (dir === 'cw') { dx = H - 1 - y; dy = x; }
        else if (dir === 'ccw') { dx = y; dy = W - 1 - x; }
        else { dx = W - 1 - x; dy = H - 1 - y; }
        const di = (dy * outW + dx) * 4;
        out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
      }
    }
    const enc = jpeg.encode({ data: out, width: outW, height: dir === 'r180' ? H : W }, 85);
    return Buffer.from(enc.data).toString('base64');
  } catch (e) {
    return null;
  }
}

/* ---------------- 适配器工厂 ---------------- */

/**
 * @param deps { env?, httpPost?, now?, fetchImage? }
 *   fetchImage(fileID) -> Promise<Buffer|null>：api 上下文按 fileID 取图
 *   （wx-server-sdk downloadFile）；recognize 也接受 opts.imageBase64 直传。
 */
function createAdapter(deps = {}) {
  const httpPost = typeof deps.httpPost === 'function' ? deps.httpPost : defaultHttpPost;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const fetchImage = typeof deps.fetchImage === 'function' ? deps.fetchImage : null;

  async function callOcr(action, imageBase64, cfg) {
    const payload = JSON.stringify({ ImageBase64: imageBase64 });
    const timestamp = Math.floor(now() / 1000);
    const { authorization } = buildAuthorization({
      secretId: cfg.secretId, secretKey: cfg.secretKey, action, timestamp, payload,
    });
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Host: HOST,
      'X-TC-Action': action,
      'X-TC-Version': VERSION,
      'X-TC-Region': cfg.region,
      'X-TC-Timestamp': String(timestamp),
      Authorization: authorization,
    };
    let res;
    try {
      res = await httpPost({ host: HOST, path: '/', headers, body: payload });
    } catch (e) {
      throw ocrServiceError();
    }
    const resp = res && res.json && res.json.Response;
    if (!resp || resp.Error) throw ocrServiceError();
    return Array.isArray(resp.TextDetections) ? resp.TextDetections : [];
  }

  return {
    name: 'tencent',
    async recognize(imagePath, opts = {}) {
      if (!imagePath && !opts.imageBase64) throw new Error('请先拍照');
      const cfg = getConfig(deps.env);
      if (!cfg.configured) throw ocrServiceError();
      let imageBase64 = opts.imageBase64 || '';
      if (!imageBase64) {
        if (!fetchImage) throw ocrServiceError();
        const buf = await fetchImage(imagePath);
        if (!buf) throw new Error('这张照片没认出来');
        imageBase64 = Buffer.from(buf).toString('base64');
      }
      const mode = opts.mode || opts.ocrMode || '';
      /* 一轮完整识别（指定的人像/给定图片字节）：返回行、采用引擎、
       * 质量分、本轮留痕与首调碎片；无行不抛错（抛错语义留给外层，
       * 以便转正重试接管）；服务级错误照常冒泡。 */
      const attempt = async (b64) => {
        const traceCalls = [];
        let firstDets = null;
        const runCall = async (action) => {
          const dets = await callOcr(action, b64, cfg);
          if (firstDets === null) firstDets = dets;
          const q = assessQuality(dets);
          traceCalls.push(buildTraceCall(action, dets, q));
          return { dets, q };
        };
        if (mode === 'print') {
          const { dets, q } = await runCall('GeneralBasicOCR');
          return { rows: q.rows, chosen: 'print', score: q.score, traceCalls, firstDets, chosenDets: dets };
        }
        if (mode === 'handwriting') {
          const { dets, q } = await runCall('GeneralHandwritingOCR');
          return { rows: q.rows, chosen: 'handwriting', score: q.score, traceCalls, firstDets, chosenDets: dets };
        }
        /* BM批（用户拍板试效果）：双调取优——手写、印刷都调，按质量分
         * （含姓名可信度）选优。旧版手写过关即短路，模板单上印刷根本没机
         * 会上场、手写垃圾长名蒙混过关（升学宴真机实证）。代价：每图
         * 固定 2 次调用。 */
        const hw = await runCall('GeneralHandwritingOCR');
        let print = null;
        try {
          print = await runCall('GeneralBasicOCR');
        } catch (e) {
          if (!hw.q.rows.length) throw e; // 手写也无果才让印刷错误冒泡
        }
        let best = hw.q;
        let chosen = 'handwriting';
        let bestDets = hw.dets;
        if (print && print.q.score > hw.q.score) { best = print.q; chosen = 'print'; bestDets = print.dets; }
        return { rows: best.rows, chosen, score: best.score, traceCalls, firstDets, chosenDets: bestDets };
      };
      let result = await attempt(imageBase64);
      let resultB64 = imageBase64;
      let rotated = '';
      /* BL批转正＋BZ批四方向：首轮差时把图转正后整轮重识，按质量分取优；
       * 方向按 pickRotationDirs 定（转置怀疑 → 顺/逆 90°；首轮差 → 再加 180°）。
       * 只对认得差的照片多花调用，正常照片不受影响；同 job 只扣一次分。 */
      const dirs = pickRotationDirs({
        suspect: rotationSuspect(result.firstDets, result.score),
        score: result.score,
        rowsEmpty: !result.rows.length,
      });
      for (const dir of dirs) {
        const rb64 = rotateJpegBase64(imageBase64, dir);
        if (!rb64) break;
        const r2 = await attempt(rb64);
        if (r2.rows.length && r2.score > result.score) { result = r2; resultB64 = rb64; rotated = dir; break; }
        if (!result.rows.length && r2.rows.length) { result = r2; resultB64 = rb64; rotated = dir; break; }
      }
      /* BY批列模式：已转正图上检红线网格，自信时按数数配对重排；网格失败
       * 或配对无果一律回落现有结果，不抛错、不影响计费（只换行，不换调用）。 */
      let gridInfo = null;
      try {
        const grid = detectGridFromJpeg(resultB64);
        if (grid && result.chosenDets) {
          const gp = parseWithGrid(result.chosenDets, grid);
          if (gp.rows.length) {
            result = { ...result, rows: gp.rows };
            gridInfo = { columns: grid.columns.length, paired: gp.paired, mismatch: gp.mismatch || null };
          } else if (gp.mismatch) {
            gridInfo = { columns: grid.columns.length, paired: false, mismatch: gp.mismatch };
          }
        }
      } catch (e) { /* 网格失败回落，不挡主流程 */ }
      if (!result.rows.length) throw new Error('这张照片没认出来');
      result.rows.ocrTrace = finalizeTrace(result.traceCalls, result.chosen);
      if (rotated) result.rows.ocrTrace.rotated = rotated;
      if (gridInfo) result.rows.ocrTrace.grid = gridInfo;
      return result.rows;
    },
  };
}

module.exports = {
  getConfig,
  isConfigured,
  buildAuthorization,
  parseDetections,
  splitNameAmount,
  parseChineseAmount,
  findAllAmounts,
  clusterByCentroid,
  splitWideFragments,
  dropRepeatedPrintFrags,
  guardRowNames,
  rotationSuspect,
  rotateJpegBase64,
  pickRotationDirs,
  detectGridFromJpeg,
  parseWithGrid,
  decodeVerticalAmountTail,
  assessQuality,
  createAdapter,
  HOST,
  VERSION,
  QUALITY_MIN_CONFIDENCE,
  QUALITY_SINGLE_CHAR_RATIO,
  QUALITY_LATIN_RUN,
};
