/**
 * AH批断言（2026-10-25，用户视频复刻 + 引导图换新）：
 * 1) 小喇叭（收礼页）：通栏长条（margin 0、无圆角）、图标 20px、文字 14px；
 *    文案保持不变（receive.js hornText 原文）；滚动估算按 14px 字宽调用。
 * 2) 侧滑修改/删除：各 56px（SWIPE_W=112）、修改橙 #FCA523、删除红 #F06D6A。
 * 3) 引导图源数据：真实感人名、无编号式假名；收礼单礼薄「李明轩的婚礼」；
 *    竖线树收礼用自家亲人事件命名、送礼不少于 5 条。
 */
const assert = require('assert');
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');

(function run() {
  const wxss = read('miniprogram/pages/receive/receive.wxss');
  const horn = wxss.match(/\.horn \{[^}]*\}/)[0];
  assert(/margin:\s*0;/.test(horn) && !/border-radius/.test(horn), '喇叭须通栏（margin 0、无圆角）');
  assert(wxss.includes('.horn-icon { width: 20px; height: 20px;'), '喇叭图标 20px');
  assert(/\.horn-text \{[^}]*font-size: 14px;/.test(wxss), '喇叭文字 14px');

  const js = read('miniprogram/pages/receive/receive.js');
  assert(js.includes("hornText: '查看收礼记录，从右往左滑动可以修改、删除礼簿~'"), '喇叭文案保持不变（用户定）');
  assert(js.includes('fontPx: 14'), '滚动估算按 14px');
  assert(js.includes('const SWIPE_W = 112;'), '侧滑总宽 112');

  const act = wxss.match(/\.act \{[^}]*\}/)[0];
  assert(act.includes('width: 56px;'), '侧滑按钮各 56px');
  assert(wxss.includes('.act-edit { background: #FCA523; }'), '修改橙 #FCA523');
  assert(wxss.includes('.act-del { background: #F06D6A; }'), '删除红 #F06D6A');

  const OLD = ['欧阳修远', '周十', '孙九', '陈八', '刘七', '赵六', '王五', '张三', '李四',
    '王建国', '刘秀英', '陈志强', '孙桂兰', '李明轩', '李福田'];
  const recv = read('docs/screens/guide-assets-src/receive-records.html');
  const gifts = read('docs/screens/guide-assets-src/gifts.html');
  const tl = read('docs/screens/guide-assets-src/timeline.html');
  for (const [name, src] of [['收礼图', recv], ['送礼图', gifts], ['竖线树图', tl]]) {
    for (const o of OLD) assert(!src.includes(o), `${name}不得再有假名 ${o}`);
  }
  assert(recv.includes('儿子的婚礼') && recv.includes('陈子轩'), '收礼图为儿子的婚礼、现代人名');
  assert(gifts.includes('赵子墨'), '送礼图为另一批现代人名');
  const namesOf = (src) => [...src.matchAll(/class="nm songti">([^<]+)</g)].map((m) => m[1]);
  const recvNames = namesOf(recv); const giftNames = namesOf(gifts);
  assert(recvNames.length === 12 && giftNames.length === 8, '收礼 12 人、送礼 8 人');
  assert(recvNames.every((n) => !giftNames.includes(n)), '收礼与送礼人名不得重名（用户定）');
  assert((tl.match(/<div class="trow">/g) || []).length === 3, '竖线树共 3 条（用户定 3-4 条、去掉儿子的婚礼）');
  assert(tl.includes('女儿的升学宴') && tl.includes('周小梅'), '竖线树收礼用亲人称谓事件命名、联系人周小梅');
  const tamts = [...tl.matchAll(/class="tamt">([+-][0-9.]+)</g)].map((m) => parseFloat(m[1]));
  assert(tamts.every((a) => Math.abs(a) === 1000 || Math.abs(a) === 2000), '竖线树金额只许 1000/2000（用户定）');
  const outSum = -tamts.filter((a) => a < 0).reduce((x, y) => x + y, 0);
  const inSum = tamts.filter((a) => a > 0).reduce((x, y) => x + y, 0);
  assert(tl.includes(`送出：¥${outSum.toFixed(2)}`) && tl.includes(`收到：¥${inSum.toFixed(2)}`), '竖线树汇总与条目自洽');
  for (const src of [recv, gifts, tl]) {
    assert(!/\.songti \{ font-family:"Songti/.test(src) && !src.includes('STSong'), '复刻图字体须与真实页面同口径（全站黑体、无宋体）');
  }
  console.log('test-batch-ah OK');
})();
