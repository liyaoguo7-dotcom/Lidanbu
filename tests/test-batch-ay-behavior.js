/**
 * AY批行为测试：字体扩至六款（用户 2026-10-27 逐款亲选定版）。
 * 新增：枝芒行书（行书，代华文行楷路子）、古典宋体（明朝体味，代清刻本悦宋）、
 * 莫大毛笔（台湾毛笔字体，用户在被告知缺字后仍亲选，并定下顶替方案）。
 * 莫大缺字口径（构建期实测，字表 721 字口径）：缺 133 个简体字，其中 131 个
 * 可用它自带的繁体字形顶替（BAKUDAI_S2T），仅嵇、闫两姓字繁简皆无、走回退链。
 * 校准系数构建期量测口径：探针字墨迹面积几何均值对霞鹜文楷归一
 * （同法复现马善政定版 1.05，误差 <0.01）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const readMp = (rel) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', rel), 'utf8');

test('AY字体名单：六款齐全、id 与云端文件名定版', () => {
  assert.eq(LC.FONTS.map((f) => f.id).join(','), 'lxgw,mashanzheng,longcang,zhimang,cactus,bakudai', '六款字体顺序定版');
  assert.eq(LC.FONTS.map((f) => f.name).join(','), '霞鹜文楷,马善政毛笔体,龙藏体,枝芒行书,古典宋体,莫大毛笔', '六款中文名定版');
  assert.eq(LC.FONTS.map((f) => f.cloudFile).join(','), 'lxgw-wenkai.ttf,mashanzheng.ttf,longcang.ttf,zhimang.ttf,cactus.ttf,bakudai.ttf', '云端 TTF 文件名定版');
  for (const f of LC.FONTS) {
    assert(f.calibration >= 1 && f.calibration <= 1.3, `${f.id} 校准系数在合理区间`);
    const stack = LC.selectedStack(f.id);
    assert(stack.includes(f.family) && stack.includes('KaiTi'), `${f.id} 回退链完整`);
  }
  assert.eq(LC.fontById('zhimang').calibration, 1.24, '枝芒校准（墨迹面积法 1.16，用户真机「大一号」改定 1.24）');
  assert.eq(LC.fontById('cactus').calibration, 1.00, '古典宋体校准（与霞鹜同量级）');
  assert.eq(LC.fontById('bakudai').calibration, 1.12, '莫大校准（墨迹面积法）');
});

test('AY莫大顶替：姓名与金额逐字换繁体、字数与布局不变、别家字体不沾', () => {
  assert.eq(Object.keys(LC.BAKUDAI_S2T).length, 131, '顶替表 131 对（构建期实测）');
  assert.eq(LC.BAKUDAI_S2T['贺'], '賀', '贺→賀');
  assert.eq(LC.BAKUDAI_S2T['贰'], '貳', '贰→貳（金额大写）');
  assert.eq(LC.BAKUDAI_S2T['陆'], '陸', '陆→陸');
  assert.eq(LC.BAKUDAI_S2T['圆'], '圓', '圆→圓');
  assert.eq(LC.mapDisplayText('bakudai', '贺爱民'), '賀愛民', '姓名整串顶替');
  assert.eq(LC.mapDisplayText('lxgw', '贺爱民'), '贺爱民', '霞鹜不顶替');
  assert.eq(LC.mapDisplayText('zhimang', '贺爱民'), '贺爱民', '枝芒不顶替');
  // 列模型：莫大下姓名/金额 chars 已顶替、字数不变；原文字段保留（详情/数据不受影响）
  const c = LC.buildColumns([{ id: '1', name: '贺爱民', amountFen: 20000, tagId: 'jiehun' }], { fontId: 'bakudai' });
  const col = c.columns[0];
  assert.eq(col.nameChars.map((x) => x.ch).join(''), '賀愛民', '列姓名顶替');
  assert.eq(col.nameChars.length, 3, '顶替不改字数（布局锚定不变）');
  assert.eq(col.amountChars.map((x) => x.ch).join(''), '貳佰元整', '列金额顶替');
  assert.eq(col.amountText, '貳佰元整', '列金额文本顶替');
  assert.eq(col.name, '贺爱民', '原始姓名字段保留简体（数据与详情口径）');
  const c2 = LC.buildColumns([{ id: '1', name: '贺爱民', amountFen: 20000, tagId: 'jiehun' }], { fontId: 'lxgw' });
  assert.eq(c2.columns[0].nameChars.map((x) => x.ch).join(''), '贺爱民', '霞鹜列姓名原样');
  assert.eq(c2.columns[0].amountText, '贰佰元整', '霞鹜列金额原样');
  // 顶替表外字（嵇/闫繁简皆无）原样透传、由回退链兜底，不吞字不方框化处理
  assert.eq(LC.mapDisplayText('bakudai', '闫嵇'), '闫嵇', '表外字原样透传走回退链');
});

test('AY服务端白名单与署名：六款 TTF 可代取、署名三处齐', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions/api/index.js'), 'utf8');
  for (const fn of ['zhimang.ttf', 'cactus.ttf', 'bakudai.ttf']) {
    assert(api.includes(`'${fn}'`), `api 白名单含 ${fn}`);
  }
  assert(LC.SPEC.FONT_CREDIT.includes('枝芒行书、古典宋体、莫大毛笔'), '横置署名含新三款');
  assert(readMp('pages/mine/about.js').includes('枝芒行书、古典宋体、莫大毛笔'), '关于页署名含新三款');
  assert(readMp('pages/agreement/agreement-data.js').includes('枝芒行书、古典宋体、莫大毛笔'), '协议开源字体条款含新三款');
  const fm = require('../miniprogram/services/font-manager.js');
  assert.eq(fm.FONT_BUILD, 'v9', 'FONT_BUILD 升 v9 强制新字体重载');
});
