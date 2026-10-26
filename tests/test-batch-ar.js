/* AR批静态断言：拍照导入照片送达链（云模式先上传、任务只收 fileID、确认后清理） */
const assert = require('node:assert');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');

/* data-service：云模式先上传（ocr-imports/ 前缀、wx.cloud.uploadFile），再启动任务 */
const ds = rd('miniprogram/services/data-service.js');
assert.ok(ds.includes('ocr-imports/'), 'AR 照片云路径应带 ocr-imports/ 前缀');
assert.ok(ds.includes('wx.cloud') && ds.includes('uploadFile'), 'AR 上传应走已 init 的 wx.cloud.uploadFile（不新造传输层）');
assert.ok(ds.includes('imageFileIds'), 'AR recognizePhoto 应组装 imageFileIds 入参');
assert.ok(
  ds.indexOf('await upload(') > -1 && ds.indexOf('await upload(') < ds.indexOf('core.importer.startImportTask'),
  'AR 上传必须发生在 startImportTask 之前',
);
assert.ok(ds.includes('照片上传失败'), 'AR 上传失败应有明确报错文案');
assert.ok(ds.includes('_setUploaderForTest') && ds.includes('_setDeleterForTest'), 'AR 应留测试注入口（与 _setTransportForTest 同模式）');
assert.ok(ds.includes('cleanupImportPhotos'), 'AR 应有导入照片清理方法');
assert.ok(ds.includes('deleteFile'), 'AR 清理应走 wx.cloud.deleteFile');

/* core：startImportTask 收 imageFileIds 并逐张识别；三处副本已同步 */
for (const p of ['core/import.js', 'miniprogram/core/import.js', 'cloudfunctions/api/core/import.js']) {
  const imp = rd(p);
  assert.ok(imp.includes('imageFileIds'), `AR ${p} 应含 imageFileIds 入参`);
  assert.ok(imp.includes('for (const fileId of imageFileIds)'), `AR ${p} 应逐张按序识别`);
}

/* 页面：识别结果带 photoFileIds 进核对页；确认写入成功后清理云端照片 */
assert.ok(rd('miniprogram/pages/import/import-home.js').includes('photoFileIds'), 'AR import-home 应把 photoFileIds 存进待确认数据');
assert.ok(rd('miniprogram/pages/import/import-event.js').includes('photoFileIds'), 'AR import-event 应把 photoFileIds 存进待确认数据');
const review = rd('miniprogram/pages/import/import-review.js');
assert.ok(review.includes('photoFileIds'), 'AR 核对页应持有 photoFileIds');
assert.ok(review.includes('cleanupImportPhotos'), 'AR 核对页确认成功后应清理云端照片');
assert.ok(review.includes('photoPath: pending.photoPath'), 'AR 核对页对照图仍走本地 photoPath（展示口径不变）');

/* 识别/扣分语义守恒：识别仍在扣分之前（既有 AQ 断言口径在新结构下继续成立） */
const impRoot = rd('core/import.js');
assert.ok(
  impRoot.indexOf('await ocr.recognize') > -1 && impRoot.indexOf('await ocr.recognize') < impRoot.indexOf('await points.spend'),
  'AR 识别仍在扣分之前（失败不扣）',
);

/* 文档：第五节排查口径已按新链路修订、留存策略写明 */
const doc = rd('docs/OCR腾讯云接入.md');
assert.ok(!doc.includes('客户端目前传的是本地照片路径'), 'AR 文档第五节不应再把"传本地路径"写成现状');
assert.ok(doc.includes('imageFileIds'), 'AR 文档应写明任务入参为 imageFileIds');
assert.ok(doc.includes('ocr-imports/'), 'AR 文档应写明照片云存储前缀与留存口径');

console.log('AR 静态断言全过');
