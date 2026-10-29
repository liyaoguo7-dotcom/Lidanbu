/** CI批（用户 2026-10-29 定）：识别页（拍照导入页）补充一句提醒——
 * 为了识别更准确，尽量使用字迹清晰、页面平展的礼单薄进行识别。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CI 识别页有字迹清晰平展提醒', () => {
  const wxml = readMp('pages/import/import-photos.wxml');
  assert(wxml.includes('字迹清晰'), '提醒含字迹清晰');
  assert(wxml.includes('平展'), '提醒含页面平展');
  assert(wxml.includes('ph-tip'), '提醒用 ph-tip 样式');
  const wxss = readMp('pages/import/import-photos.wxss');
  assert(wxss.includes('.ph-tip {'), 'ph-tip 样式存在');
});
