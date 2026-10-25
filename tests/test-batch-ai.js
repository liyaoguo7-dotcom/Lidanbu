/* AI批：小喇叭全站统一为收礼页规格（2026-10-25 用户定：所有喇叭照收礼页样式、
   长文本滚动也照收礼页）——通栏、图标20px、字14px橙字、滚动参数 {fontPx:14, avail:284} */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');
const read = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

function run() {
  // 全部滚动调用点必须带收礼页参数（receive 本尊 + 6 页 + tip-bar 组件）
  const sites = ['pages/receive/receive.js', 'pages/index/index.js', 'pages/contacts/contacts.js',
    'pages/choose-contact/choose-contact.js', 'pages/import/import-event.js',
    'pages/import/import-home.js', 'pages/import/import-review.js', 'components/tip-bar/tip-bar.js'];
  for (const f of sites) {
    const js = read(f);
    const calls = [...js.matchAll(/hornMarquee\([^)]*\)/g)].map((m) => m[0]);
    assert(calls.length >= 1, `${f} 应有 hornMarquee 调用`);
    for (const c of calls) assert(c.includes('fontPx: 14') && c.includes('avail: 284'), `${f} 滚动参数须与收礼页一致：${c}`);
  }
  // app.wxss .tip（首页/亲友录/选择亲友/导入三页共用）与收礼页 .horn 同规格
  const app = read('app.wxss');
  const tip = app.match(/\.tip \{[^}]*\}/)[0];
  for (const v of ['padding: 10px 12px', 'font-size: 14px', 'color: #E8912D', 'background: #FFF8E1', 'margin: 0'])
    assert(tip.includes(v), `.tip 须含 ${v}`);
  const icon = app.match(/\.tip-icon \{[^}]*\}/)[0];
  assert(icon.includes('width: 20px') && icon.includes('height: 20px'), '.tip-icon 须 20px（收礼页同规格）');
  const recv = read('pages/receive/receive.wxss');
  const horn = recv.match(/\.horn \{[^}]*\}/)[0];
  assert(horn.includes('padding: 10px 12px') && horn.includes('background: #FFF8E1'), '收礼页 .horn 仍为基准规格');
  // tip-bar 组件同规格（rpx 计：20px 图标=40rpx、14px 字=28rpx）
  const tb = read('components/tip-bar/tip-bar.wxss');
  assert(tb.includes('width: 40rpx') && tb.includes('font-size: 28rpx') && tb.includes('#E8912D'), 'tip-bar 组件须与收礼页同规格');
}
run();
console.log('test-batch-ai OK');
