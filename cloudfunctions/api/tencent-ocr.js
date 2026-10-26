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
 *   未指定             → 先印刷体；印刷体没认出任何文字时再调手写体兜底。
 * 两次都没认出（或图片取不到）→ 抛「这张照片没认出来」，走既有
 * "识别失败不扣费"语义（core/import 在识别成功后才扣积分）。
 *
 * 返回行与 MockOCR 完全同形：[{ name, amountFen|null, note, raw }]，
 * 顺序与完整性遵守 core/ocr-adapter 的冻结契约：整页先分栏（左栏在前）、
 * 栏内自上而下、行内碎片按 X 拼接；识别不出金额的行保留姓名、金额留空；
 * 只有金额的行保留空姓名占位；不丢行。
 *
 * HTTP 层可注入（opts.httpPost），测试一律打桩、绝不真连网；
 * 默认实现只用 Node 内置 https，零新增依赖。
 */
const crypto = require('crypto');
const https = require('https');

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

/* ---------------- 结果解析（纯函数） ---------------- */

function bboxOf(det) {
  const ip = det && det.ItemPolygon;
  if (ip && typeof ip.X === 'number' && typeof ip.Width === 'number') {
    return { x: ip.X, y: ip.Y || 0, w: ip.Width, h: ip.Height || 0 };
  }
  const poly = det && det.Polygon;
  if (Array.isArray(poly) && poly.length) {
    const xs = poly.map((p) => p.X || 0);
    const ys = poly.map((p) => p.Y || 0);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
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

/**
 * 把一行文本拆成 { name, amountFen, note }：
 * 取行内最后一个数字 token 作金额（元→分，容忍千分位逗号/小数/¥/元/圆/整），
 * 金额之前是姓名、之后残余文本是备注（如"同学"）；没数字则整行是姓名。
 */
function splitNameAmount(text) {
  const re = /(?:¥|￥)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:元|圆|整)?/g;
  let m = null;
  let last = null;
  while ((m = re.exec(text)) !== null) {
    last = { num: m[1], index: m.index, end: m.index + m[0].length };
    if (m[0] === '') re.lastIndex += 1; // 防零宽死循环（理论不会发生）
  }
  const clean = (s) => String(s || '').replace(/^[\s:：,，、]+|[\s:：,，、]+$/g, '');
  if (!last) return { name: clean(text), amountFen: null, note: '' };
  const numStr = last.num.replace(/,/g, '');
  const dot = numStr.indexOf('.');
  const yuan = dot >= 0 ? numStr.slice(0, dot) : numStr;
  const cents = dot >= 0 ? (numStr.slice(dot + 1) + '00').slice(0, 2) : '00';
  const amountFen = parseInt(yuan || '0', 10) * 100 + parseInt(cents, 10);
  let name = clean(text.slice(0, last.index));
  if (/^[\d\s.,，¥￥元圆整]+$/.test(name)) name = ''; // 姓名位只有数字/符号 → 金额占位行
  const note = clean(text.slice(last.end));
  return { name, amountFen: amountFen > 0 ? amountFen : null, note };
}

/**
 * TextDetections → rows（与 MockOCR 同形）。
 * 分栏：碎片按 X 区间重叠（≥50% 较窄者）聚类成栏，栏从左到右；
 * 栏内按 Y 分行（Y 重叠 ≥50% 较矮者为同行），行从上到下；
 * 行内碎片按 X 从左到右拼成一行文本再拆姓名/金额。
 * 窄守卫合并：若某栏全部行都"只有金额没姓名"且与前一栏行数相同、
 * 前一栏全部行都"只有姓名没金额"，按序两两合并（姓名/金额被厂商拆成
 * 两栏碎片时的恢复口径，真实礼单不会出现整栏只有金额的排版）。
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

  /* —— 分栏（并查集：X 区间重叠 ≥ 0.5 聚为一栏） —— */
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
  const columns = [...colMap.values()]
    .map((list) => ({ list, xMin: Math.min(...list.map((f) => f.x)) }))
    .sort((a, b) => a.xMin - b.xMin);

  /* —— 栏内分行、行内拼接、拆姓名金额 —— */
  const colRows = columns.map(({ list }) => {
    const sorted = [...list].sort((a, b) => (a.cy - b.cy) || (a.x - b.x));
    const lines = [];
    for (const f of sorted) {
      const line = lines.find((ln) => overlapRatio(f.y, f.h, ln.yMin, ln.yMax - ln.yMin) >= 0.5);
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
      return { name, amountFen, note, raw };
    });
  });

  /* —— 窄守卫合并（金额栏与姓名栏被拆开的恢复） —— */
  const merged = [];
  for (let c = 0; c < colRows.length; c++) {
    const rows = colRows[c];
    const prev = merged[merged.length - 1];
    if (prev && rows.length > 0 && rows.length === prev.length
      && rows.every((r) => !r.name && r.amountFen !== null)
      && prev.every((r) => r.name && r.amountFen === null)) {
      for (let i = 0; i < rows.length; i++) {
        prev[i] = {
          name: prev[i].name,
          amountFen: rows[i].amountFen,
          note: prev[i].note || rows[i].note || '',
          raw: `${prev[i].raw} ${rows[i].raw}`.trim(),
        };
      }
    } else {
      merged.push(rows);
    }
  }
  return merged.flat();
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
      let rows = [];
      if (mode !== 'handwriting') {
        rows = parseDetections(await callOcr('GeneralBasicOCR', imageBase64, cfg));
        if (rows.length > 0 || mode === 'print') {
          if (!rows.length) throw new Error('这张照片没认出来');
          return rows;
        }
      }
      // 手写模式，或印刷体没认出任何文字 → 手写体兜底
      rows = parseDetections(await callOcr('GeneralHandwritingOCR', imageBase64, cfg));
      if (!rows.length) throw new Error('这张照片没认出来');
      return rows;
    },
  };
}

module.exports = {
  getConfig,
  isConfigured,
  buildAuthorization,
  parseDetections,
  splitNameAmount,
  createAdapter,
  HOST,
  VERSION,
};
