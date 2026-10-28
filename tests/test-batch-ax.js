/**
 * AX批静态断言（2026-10-27，用户真机看白事横置后亲定）：
 * 「奠仪」两字加粗——奠仪与姓名金额同为近黑、同字重时分不出主次，
 * 要求只给奠仪稍微加黑一点。实现口径（颜色于 2026-10-28 用户定为纯黑 #000000，取代近黑）：
 * ① 中段词全站只有一个渲染点：landscape/book.wxml 的 .zone-mid 逐字 text
 *    （gift/receive 两页同 import 这一份模板；半屏详情的 data 里虽带 detail.midText，
 *    但 wxml 从不渲染它，只显示「场合」文字行，故无第二处要处理）；
 * ② 加粗严格按列的 midBlack 条件走（midBlack ⇔ 中段词=奠仪）：
 *    奠仪列 font-weight:bold、贺礼列 normal；颜色口径（2026-10-28 用户定）
 *    （奠仪 #000000 纯黑 / 贺礼 theme.midColor）；
 * ③ 姓名/金额两段不得沾加粗；定位口径（.vchar 绝对定位、top 预计算）不动——
 *    加粗只横向加宽、且 .vchar 是 left:50%+translateX(-50%) 居中锚定，
 *    宋体 23px 加粗后单字宽 ≈25px « 列宽 50，两侧各有 ~12px 余量，不溢出不叠字。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape/book.wxml'), 'utf8');

/* ① 中段词渲染点唯一：全 miniprogram 的 wxml 里只有 book.wxml 渲染 midChars */
const { execSync } = require('child_process');
const hits = execSync(
  `grep -rl "midChars" --include=*.wxml ${path.join(__dirname, '..', 'miniprogram')}`,
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean);
assert.strictEqual(hits.length, 1, 'AX 中段词渲染点应唯一（只有一份 wxml 渲染 midChars）');
assert.ok(hits[0].endsWith('pages/landscape/book.wxml'), 'AX 唯一渲染点应是 landscape/book.wxml');

/* 半屏详情不渲染 detail.midText（只带数据不显示，无第二处理点） */
assert.ok(!wxml.includes('{{detail.midText}}'), 'AX 半屏详情不应渲染 detail.midText');

/* gift/receive 两页同 import 这一份 book.wxml（一处改两边生效） */
for (const p of ['gift/gift.wxml', 'receive/receive.wxml']) {
  const sub = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape', p), 'utf8');
  assert.ok(sub.includes('<import src="../book.wxml" />'), `AX ${p} 应 import 共用 book.wxml`);
}

/* ② 中段逐字 text（属性跨两行：wx:for 一行、style 一行，按 zone-mid 区块断言）：
      加粗按 midBlack 条件、颜色口径未动 */
const midStart = wxml.indexOf('zone-mid');
assert.ok(midStart >= 0, 'AX 应能找到 zone-mid 区块');
const midBlock = wxml.slice(midStart, wxml.indexOf('</view>', midStart));
assert.ok(midBlock.includes('item.midChars'), 'AX zone-mid 区块应渲染 midChars');
assert.ok(
  midBlock.includes("font-weight:{{item.midBlack ? 'bold' : 'normal'}}"),
  'AX 中段字重应按 midBlack 条件：奠仪 bold、贺礼 normal'
);
assert.ok(
  midBlock.includes("color:{{item.midBlack ? '#000000' : theme.midColor}}"),
  'AX 中段颜色口径（2026-10-28 用户定：奠仪 #000000 纯黑 / 贺礼主题色）'
);
assert.ok(midBlock.includes('font-family:{{songtiStack}}'), 'AX 中段字体应仍是印刷宋体');

/* ③ 姓名/金额段不沾加粗（全文件 font-weight 只许出现在中段那一处） */
const fwCount = (wxml.match(/font-weight/g) || []).length;
assert.strictEqual(fwCount, 1, 'AX book.wxml 里 font-weight 应只出现 1 处（中段条件加粗）');
for (const zone of ['zone-name', 'zone-amt']) {
  const s = wxml.indexOf(zone);
  assert.ok(s >= 0, `AX 应能找到 ${zone} 区块`);
  const block = wxml.slice(s, wxml.indexOf('</view>', s));
  assert.ok(!block.includes('font-weight'), `AX ${zone} 段不得加粗`);
}

/* 定位口径未动：.vchar 仍是绝对定位居中锚（加粗横向变宽不挪位、不叠字的前提） */
const wxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape/book.wxss'), 'utf8');
const vchar = wxss.match(/\.vchar \{([^}]*)\}/);
assert.ok(vchar && /position:\s*absolute/.test(vchar[1]) && /translateX\(-50%\)/.test(vchar[1]),
  'AX .vchar 应保持绝对定位＋水平居中锚');

console.log('AX批静态断言通过（奠仪条件加粗/渲染点唯一/颜色与定位未动）');
