'use strict';
/* BN批回归（2026-10-27 晚用户截图反馈＋逐条定版）：
 * ① 礼薄名乱码：navigateTo 传参的 eventName 在攒照片页 onLoad 必须解码
 * ② 开始识别去弹窗、计费说明单价动态——静态断言在 BJ 测试里同步更新，
 *    本文件补乱码一条。 */
const { test, assert } = require('./fw');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');

test('BN乱码：攒照片页进页解码礼薄名（decodeURIComponent＋异常兜底）', () => {
  const ph = rd('miniprogram/pages/import/import-photos.js');
  assert(ph.includes('decodeURIComponent(eventName)'), 'onLoad 应解码 eventName');
  assert(ph.includes('catch (e)'), '解码应有异常兜底');
  const ev = rd('miniprogram/pages/import/import-event.js');
  assert(ev.includes('encodeURIComponent(eventName'), '发送端编码与接收端解码应成对');
});
