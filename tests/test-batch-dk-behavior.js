/** DK批（用户 2026-10-30 定）：拍照导入页温馨提示与添加照片框对调——
 * 提示块移到照片区下方、计费说明上面（送礼收礼共用此页，两边同生效）；
 * 提示文案、计费说明、开始识别按钮都不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DK 拍照导入页：温馨提示在照片区下方、计费说明上面', () => {
  const wxml = readMp('pages/import/import-photos.wxml');
  const wxss = readMp('pages/import/import-photos.wxss');
  const head = wxml.slice(wxml.indexOf('ph-head'), wxml.indexOf('ph-grid'));
  assert(!head.includes('ph-tip'), '提示块已移出头部');
  assert(wxml.indexOf('ph-add') < wxml.indexOf('ph-tip'), '添加照片框在提示块上面（对调）');
  assert(wxml.indexOf('ph-tip') < wxml.indexOf('ph-fee'), '提示块在计费说明上面');
  assert(wxml.includes('温馨提示：为了识别更准确'), '提示文案不动');
  assert(wxml.includes('计费说明') && wxml.includes('开始识别'), '计费说明与开始识别不动');
  assert(wxss.includes('.ph-tip { display: block; margin: 0 16px 10px;'), '提示块左右 16px 与计费块对齐、下留 10px 分开');
});
