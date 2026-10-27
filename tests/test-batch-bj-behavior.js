/**
 * BJ批回归（2026-10-27 用户口述定版）：
 * ① 姓名库扩库——笔画多（鑫/焱/麒）与稍生僻（婧/璎/嫣）的真人名用字在池；
 * ② 多图识别——攒照片页注册齐全、计费口径明示（BN批改：不再有开始前
 *    确认弹窗、单价读配置动态生成）、逐张识别、入口从 import-home/event 迁走；
 * ③ 快速创建——核对页原地建亲友（BN批定版为弹窗内直接编辑姓名/备注），
 *    「先建亲友」字样全端清除；待核对队列函数行为。
 */
const { test, assert } = require('./fw');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');

test('BJ姓名库扩库：笔画多与稍生僻的人名用字在池', () => {
  const db = require('../cloudfunctions/api/name-db');
  for (const ch of ['鑫', '焱', '麒', '麟', '淼', '犇']) assert(db.MALE_CHARS.has(ch) || db.NEUTRAL_CHARS.has(ch), `男池应含 ${ch}`);
  for (const ch of ['婧', '璎', '嫣', '婵', '珞']) assert(db.FEMALE_CHARS.has(ch), `女池应含 ${ch}`);
  assert(db.SURNAMES.has('黑') && db.SURNAMES.has('侯') && db.SURNAMES.has('沈'), '稀少真姓在姓池');
});

test('BJ待核对队列：存取顺序与计数', () => {
  const st = require('../miniprogram/services/import-state.js');
  st.saveImport(null);
  st.setImportQueue([{ jobId: 'a' }, { jobId: 'b' }]);
  assert.eq(st.importQueueCount(), 2, '队列计数');
  assert.eq(st.takeNextImport().jobId, 'a', '先入先出');
  assert.eq(st.takeNextImport().jobId, 'b');
  assert.eq(st.takeNextImport(), null, '取空返回 null');
  assert.eq(st.importQueueCount(), 0);
});

test('BJ多图识别：攒照片页与开始识别口径（BN批：无确认弹窗、单价动态）', () => {
  const app = JSON.parse(rd('miniprogram/app.json'));
  assert(app.pages.includes('pages/import/import-photos'), 'app.json 应注册攒照片页');
  const ph = rd('miniprogram/pages/import/import-photos.js');
  assert(ph.includes('chooseMedia'), '选图走 chooseMedia 多选');
  assert(!ph.includes('开始识别？'), 'BN 定版：开始识别不再弹确认窗');
  assert(ph.includes('getPointsSettings') && ph.includes('photoImportCost'), '单价应读服务端积分规则');
  assert(ph.includes('recognizePhoto(photos[i]'), '逐张识别（一张一个任务、按张计费）');
  assert(ph.includes('setImportQueue'), '多张结果排队进核对');
  const wxml = rd('miniprogram/pages/import/import-photos.wxml');
  assert(wxml.includes('开始识别') && wxml.includes('计费说明'), '页面应有开始识别按钮与计费说明');
  assert(wxml.includes('{{photoCost}}') && wxml.includes('识别失败不扣费') && wxml.includes('不退还积分'), '计费说明应按生效单价动态生成并写明口径');
  for (const p of ['miniprogram/pages/import/import-home.js', 'miniprogram/pages/import/import-event.js']) {
    const src = rd(p);
    assert(!src.includes('chooseImage') && !src.includes('recognizePhoto'), `${p} 不应再直接选图识别`);
    assert(src.includes('import-photos'), `${p} 应跳攒照片页`);
  }
});

test('BJ快速创建（BN定版）：弹窗内编辑姓名/备注＋提醒原话＋旧两段式清除', () => {
  const rv = rd('miniprogram/pages/import/import-review.js');
  assert(rv.includes('onQuickCreate') && rv.includes('onQcConfirm'), '核对页应有快速创建弹窗处理');
  assert(!rv.includes('快速创建前，先确认备注') && !rv.includes('先改备注'), 'BJ 两段式弹窗应已删除');
  assert(rv.includes('createContact({ name, remark })'), '确认时应以弹窗内姓名＋备注建亲友（同步亲友录）');
  assert(rv.includes('goNextJob') && rv.includes('takeNextImport'), '结果页应能接着核对下一张');
  const wxml = rd('miniprogram/pages/import/import-review.wxml');
  assert(wxml.includes('快速创建') && wxml.includes('queueCount'), '核对页应有快速创建按钮与下一张按钮');
  assert(wxml.includes('请先确认姓名和备注无误，快速创建将会同步亲友录'), '弹窗提醒应为用户定版原话');
  assert(wxml.includes('qcName') && wxml.includes('qcRemark'), '弹窗应有姓名/备注输入框');
  for (const p of ['miniprogram/pages/import/import-review.wxml', 'miniprogram/pages/import/import-review.js', 'core/import.js']) {
    assert(!rd(p).includes('先建亲友'), `${p} 不应再有「先建亲友」`);
  }
});
