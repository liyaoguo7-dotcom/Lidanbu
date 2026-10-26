/* AQ批静态断言：腾讯云 OCR 接线位置、密钥卫生、文档齐全 */
const assert = require('node:assert');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');
const has = (p) => fs.existsSync(__dirname + '/../' + p);

/* 真实适配器只在云函数侧，不进小程序包、不进 core 副本目录 */
assert.ok(has('cloudfunctions/api/tencent-ocr.js'), 'AQ 腾讯云适配器应在 cloudfunctions/api/');
assert.ok(!has('miniprogram/core/tencent-ocr.js'), 'AQ 适配器绝不进小程序包');
assert.ok(!has('cloudfunctions/api/core/tencent-ocr.js'), 'AQ 适配器不在 sync 覆盖的 core 副本里');

const ocr = rd('cloudfunctions/api/tencent-ocr.js');
assert.ok(ocr.includes('TENCENT_SECRET_ID') && ocr.includes('TENCENT_SECRET_KEY'), 'AQ 密钥从环境变量读');
assert.ok(ocr.includes('TENCENT_OCR_REGION'), 'AQ 地域可用环境变量覆盖');
assert.ok(ocr.includes('GeneralBasicOCR') && ocr.includes('GeneralHandwritingOCR'), 'AQ 印刷体+手写体两接口');
assert.ok(ocr.includes('TC3-HMAC-SHA256'), 'AQ 使用 TC3 签名');
assert.ok(ocr.includes('ocr.tencentcloudapi.com'), 'AQ 域名正确');
assert.ok(!ocr.includes('AKID'), 'AQ 适配器文件不得出现任何真实密钥字面量');
assert.ok(!/console\.log/.test(ocr), 'AQ 适配器不得打日志（防密钥/图片内容外漏）');

/* api 分发：选择逻辑在 importer 分支、管理员口径与既有一致、日志只记实现名 */
const api = rd('cloudfunctions/api/index.js');
assert.ok(api.includes("require('./tencent-ocr')"), 'AQ api 应引入腾讯云模块');
assert.ok(api.includes('pickServerOcrAdapter'), 'AQ api 应有服务端选择函数');
assert.ok(api.includes('next.ocrAdapter = adapter'), 'AQ 适配器应注入 startImportTask 的 opts');
assert.ok(api.includes("adapter=${adapter ? 'tencent' : 'mock'}"), 'AQ 日志只记实现名');

/* core 接缝：ocr-adapter 支持注入、import 透传并回标 adapter 名 */
const adapter = rd('core/ocr-adapter.js');
assert.ok(adapter.includes('opts.adapter'), 'AQ ocr-adapter 应支持 opts.adapter 注入');
const imp = rd('core/import.js');
assert.ok(imp.includes('ocrAdapter') && imp.includes('adapter: adapterName'), 'AQ import 应透传适配器并回标 adapter 名');
assert.ok(rd('cloudfunctions/api/core/import.js').includes('ocrAdapter'), 'AQ api core 副本已同步');
assert.ok(rd('miniprogram/core/import.js').includes('ocrAdapter'), 'AQ 小程序 core 副本已同步');

/* 既有语义守恒：扣分仍在识别成功之后、Mock 罐头未动 */
assert.ok(imp.indexOf('await ocr.recognize') > -1 && imp.indexOf('await ocr.recognize') < imp.indexOf('await points.spend'), 'AQ 识别仍在扣分之前（失败不扣）');
assert.ok(adapter.includes("name: '张三', amountFen: 100000"), 'AQ Mock 罐头数据未动');

/* 文档 */
assert.ok(has('docs/OCR腾讯云接入.md'), 'AQ 应有 docs/OCR腾讯云接入.md');
const doc = rd('docs/OCR腾讯云接入.md');
assert.ok(doc.includes('TENCENT_SECRET_ID') && doc.includes('TENCENT_SECRET_KEY'), 'AQ 文档应含环境变量清单');
assert.ok(doc.includes('环境变量'), 'AQ 文档应写明控制台填环境变量的位置');
assert.ok(doc.includes('验收清单'), 'AQ 文档应含真机验收清单');
assert.ok(doc.includes('管理员'), 'AQ 文档应写明当前仅管理员可用');

console.log('AQ 静态断言全过');
