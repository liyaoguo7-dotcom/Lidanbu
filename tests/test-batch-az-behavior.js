/**
 * AZ批断言（2026-10-27，用户真机看共享两页后亲改）：
 * ① 共享邀请页顶部标语撤掉——标语不属于这页；
 * ② 邀请页「被邀请人的操作权限」的括号说明跟在「权限」后同段连排，不再单独一行；
 * ③ 三句标语移到共享首页：黄条正下方、邀请卡上方，全宽白底贴合（中间不留灰），
 *    右上角低调小叉可关；关后写入本机 storage 标记、不再显示，页面恢复无标语样子；
 * ④ 黄条与邀请卡之间的灰色间隔去掉（卡 margin-top:0；标语块在时亦全宽贴合）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const rd = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const inv = rd('miniprogram/pages/share/share-invite.wxml');
const home = rd('miniprogram/pages/share/share-home.wxml');
const homeJs = rd('miniprogram/pages/share/share-home.js');
const SLOGANS = ['今年你送出去了多少礼？', '出门在外，想查往来却找不到礼簿？', '纸质礼簿越记越厚，翻找一笔好费劲？'];

test('AZ共享两页：邀请页撤标语+权限说明同段；共享首页标语块可关且不留灰', () => {
  // ① 邀请页无标语（三句都不许出现）
  for (const s of SLOGANS) assert(!inv.includes(s), `邀请页不应有标语「${s}」`);
  // ② 权限标题与括号说明同在一个 section-title 内连排
  const titleLine = inv.split('\n').find((l) => l.includes('section-title') && l.includes('被邀请人的操作权限'));
  assert(!!titleLine, '邀请页应有权限标题行');
  assert(titleLine.includes('（勾上哪项，被邀请人就能对你共享的记录做哪项操作）'), '括号说明应跟在权限标题后同段');
  assert(!inv.includes('section-note'), '旧的单独说明行（section-note）应已移除');
  // ③ 共享首页标语块：三句齐、位置在黄条与邀请卡之间、小叉关闭
  for (const s of SLOGANS) assert(home.includes(s), `共享首页标语块应含「${s}」`);
  const iTip = home.indexOf('class="tip"');
  const iSlogan = home.indexOf(SLOGANS[0]);
  const iCard = home.indexOf('form-label">邀请家人');
  assert(iTip >= 0 && iTip < iSlogan && iSlogan < iCard, '标语块应在黄条之下、邀请卡之上');
  assert(home.includes('wx:if="{{showSlogans}}"'), '标语块受 showSlogans 控制');
  assert(home.includes('bindtap="onCloseSlogans"'), '标语块应有低调小叉关闭');
  assert(homeJs.includes('shareHomeSlogansClosed'), '关闭标记应落本机 storage');
  assert(homeJs.includes('onCloseSlogans'), '页面应有关闭处理函数');
  // ④ 去灰：邀请卡 margin-top:0、标语块全宽（margin:0）
  assert(home.includes('class="card" style="margin-top:0"'), '邀请卡应贴黄条/标语块（margin-top:0）');
  assert(home.includes('background:#FFFFFF;margin:0'), '标语块应全宽白底贴合（不留灰）');
});
