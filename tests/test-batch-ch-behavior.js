/** CH批（用户 2026-10-29 定＋真机错例）：
 * 1. 备注默认空：金额后残余、列尾残余不再进备注（横置红本第1条“。元四”、
 *    第10条“OD”、第12条“统、加”皆为残余进备注所致）。
 * 2. 手写叁常被认成参：参→叁进金额解析（参佰元＝300；参伍佰→伍佰，名李参不受影响）。
 * 3. 乔姓：姓氏表补乔、形近表补介→乔（乔廷俊被认成介廷俊，猜字因缺数据未生效）。
 * 4. 万作给定名：万/萬在任何位置、后跟非单位/元/整时不断（赵万军只剩赵）。
 * 5. 自动裁黑边：视频截图上下纯黑边（带标题/水印）裁掉即全对；无黑边原样返回。
 * 6. 合计类碎片不进列拼读（底部合计15漏进末笔金额成15.00元）。 */
const { test, assert } = require('./fw');
const path = require('path');
const ocr = require('../cloudfunctions/api/tencent-ocr');
const NAME_DB = require('../cloudfunctions/api/name-db');

test('CH 备注默认空（金额后残余与列尾残余都不进备注）', () => {
  const r = ocr.splitNameAmount('天诗峰伍佰元。四');
  assert.eq(r.note, '', '金额后残余不进备注');
  assert.eq(r.name, '天诗峰', '姓名不受影响');
  assert.eq(r.amountFen, 50000, '金额不受影响');
  const rows = ocr.splitColumnText('王丽伍佰元四');
  assert.eq(rows.length, 1, '一笔');
  assert.eq(rows[0].note, '', '列尾残余不进备注');
  assert.eq(rows[0].amountFen, 50000, '列尾残余不影响金额');
});

test('CH 手写叁误读参进金额解析', () => {
  const a = ocr.findAllAmounts('参佰元').map((x) => x.yuan);
  assert.eq(JSON.stringify(a), JSON.stringify([300]), '参佰元＝300');
  const b = ocr.findAllAmounts('参伍佰元').map((x) => x.yuan);
  assert.eq(JSON.stringify(b), JSON.stringify([500]), '参伍佰→伍佰，不误吞成3500');
  const c = ocr.findAllAmounts('参仟元').map((x) => x.yuan);
  assert.eq(JSON.stringify(c), JSON.stringify([3000]), '参仟元＝3000');
  const s = ocr.splitNameAmount('李参伍佰元');
  assert.eq(s.name, '李参', '名李参不受影响');
  assert.eq(s.amountFen, 50000, '金额仍是伍佰');
});

test('CH 乔姓补库与介→乔形近', () => {
  assert(NAME_DB.SURNAMES.has('乔'), '姓氏表有乔');
  assert((NAME_DB.CONFUSION['介'] || []).includes('乔'), '形近表介→乔');
  const grid = { columns: [{ x0: 0, x1: 200 }] };
  const dets = [
    { DetectedText: '介廷俊', ItemPolygon: { X: 10, Y: 10, Width: 60, Height: 20 } },
    { DetectedText: '伍佰元', ItemPolygon: { X: 10, Y: 100, Width: 60, Height: 20 } },
  ];
  const r = ocr.parseWithGrid(dets, grid);
  assert.eq(r.rows.length, 1, '一笔');
  assert.eq(r.rows[0].name, '乔廷俊', '介廷俊纠成乔廷俊');
  assert.eq(r.rows[0].amountFen, 50000, '金额伍佰');
});

test('CH 万作给定名任何位置不断', () => {
  assert.eq(ocr.stripCapitalFromName('赵万军'), '赵万军', '赵万军不动');
  assert.eq(ocr.stripCapitalFromName('张三万元'), '张三', '万后跟元仍切');
  assert.eq(ocr.stripCapitalFromName('王丽壹万元'), '王丽', '壹万元切在壹');
});

test('CH 自动裁黑边（带字黑边也裁、无黑边原样返回）', () => {
  const jpeg = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'node_modules', 'jpeg-js'));
  const W = 400, H = 400;
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v = 255;
      if (y < 80 || y >= 360) v = 0;
      if (y === 40 && x % 7 === 0) v = 255; // 黑边上的标题笔画（约14%亮像素）
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const b64 = jpeg.encode({ width: W, height: H, data }, 90).data.toString('base64');
  const out = ocr.trimBlackBorders(b64);
  assert(out !== b64, '黑边被裁掉');
  const dec = jpeg.decode(Buffer.from(out, 'base64'));
  assert.eq(dec.width, 400, '宽不变');
  assert.eq(dec.height, 280, '上下黑边裁掉（400→280）');
  const plain = jpeg.encode({ width: 60, height: 60, data: Buffer.alloc(60 * 60 * 4, 255) }, 90).data.toString('base64');
  assert.eq(ocr.trimBlackBorders(plain), plain, '无黑边原样返回');
  assert.eq(ocr.trimBlackBorders('not-a-jpeg'), 'not-a-jpeg', '异常回落原图');
});

test('CH 合计类碎片不进列拼读', () => {
  const grid = { columns: [{ x0: 0, x1: 200 }] };
  const dets = [
    { DetectedText: '赵三', ItemPolygon: { X: 10, Y: 10, Width: 60, Height: 20 } },
    { DetectedText: '伍佰元', ItemPolygon: { X: 10, Y: 100, Width: 60, Height: 20 } },
    { DetectedText: '合计1500', ItemPolygon: { X: 10, Y: 200, Width: 80, Height: 20 } },
  ];
  const r = ocr.parseWithGrid(dets, grid);
  assert.eq(r.rows.length, 1, '一笔');
  assert.eq(r.rows[0].name, '赵三', '姓名');
  assert.eq(r.rows[0].amountFen, 50000, '金额是伍佰不是合计1500');
});
