/**
 * AT批行为测试：白事横置礼单一律奠仪（整本判定）＋OCR 奠仪滤除＋卷轴贴合几何。
 * 背景（用户 2026-10-27 亲报）：白事礼薄横置打开中段印「贺礼」是礼仪大忌、零容忍。
 * 判定收敛：标签 baishi 或 标题含 葬礼/殡葬/白事/丧事/丧礼/追悼 或 手选白事样式
 * → 整本奠仪＋收礼默认白事样式；OCR 竖排纸面印刷字滤除扩到奠仪/奠儀。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const tencentOcr = require(path.join(API_DIR, 'tencent-ocr.js'));

const det = (text, x, y, w = 220, h = 30, conf) => {
  const d = { DetectedText: text, ItemPolygon: { X: x, Y: y, Width: w, Height: h } };
  if (typeof conf === 'number') d.Confidence = conf;
  return d;
};
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

/* ---------- AT-1 白事判定 ---------- */

test('AT 白事判定：标题关键词命中（葬礼/殡葬/白事/丧事/丧礼/追悼）', () => {
  assert(LC.isFuneralBook({ tagId: 'jiehun', title: '父亲葬礼' }), '父亲葬礼＋结婚标签应判白事');
  assert(LC.isFuneralBook({ tagId: 'jiehun', title: '张家殡葬事宜' }), '殡葬命中');
  assert(LC.isFuneralBook({ tagId: 'qita', title: '白事' }), '白事命中');
  assert(LC.isFuneralBook({ tagId: 'jiehun', title: '李家丧事' }), '丧事命中');
  assert(LC.isFuneralBook({ tagId: 'jiehun', title: '母亲丧礼' }), '丧礼命中');
  assert(LC.isFuneralBook({ tagId: 'jiehun', title: '追悼会' }), '追悼命中');
});

test('AT 白事判定：普通场合不误判、标签白事无标题也命中、空参不命中', () => {
  assert(!LC.isFuneralBook({ tagId: 'jiehun', title: '儿子婚礼' }), '婚礼不命中');
  assert(!LC.isFuneralBook({ tagId: 'shengri', title: '爷爷生日' }), '生日不命中');
  assert(!LC.isFuneralBook({ tagId: 'shengxue', title: '女儿升学宴' }), '升学不命中');
  assert(LC.isFuneralBook({ tagId: 'baishi' }), '标签 baishi 无标题命中');
  assert(LC.isFuneralBook({ tagId: 'baishi', title: '' }), '标签 baishi 空标题命中');
  assert(!LC.isFuneralBook({}), '空参不命中');
  assert(!LC.isFuneralBook(), '无参不命中');
});

/* ---------- AT-1 整本中段词矩阵 ---------- */

test('AT 整本中段词：任一指向白事即奠仪、全普通才是贺礼（红线：样式切不走白事）', () => {
  assert.eq(LC.resolveBookMidText({ tagId: 'baishi' }), '奠仪', '标签白事→奠仪');
  assert.eq(LC.resolveBookMidText({ tagId: 'jiehun', title: '父亲葬礼' }), '奠仪', '标题葬礼＋标签结婚→奠仪');
  assert.eq(LC.resolveBookMidText({ tagId: 'jiehun', title: '儿子婚礼', styleId: 'funeral' }), '奠仪', '普通礼薄手选白事样式→奠仪');
  assert.eq(LC.resolveBookMidText({ tagId: 'jiehun', title: '儿子婚礼', styleId: 'classic' }), '贺礼', '全普通→贺礼');
  assert.eq(LC.resolveBookMidText({ tagId: 'baishi', styleId: 'classic' }), '奠仪', '红线：白事标签选经典样式仍奠仪');
  assert.eq(LC.resolveBookMidText({ tagId: 'jiehun', title: '父亲葬礼', styleId: 'blue' }), '奠仪', '红线：标题白事选淡蓝样式仍奠仪');
  assert.eq(LC.resolveBookMidText({}), '贺礼', '空参缺省贺礼');
});

/* ---------- AT-2 收礼主题 ---------- */

test('AT 收礼主题：标题命中白事默认 funeral，所选样式与旧签名不回退', () => {
  assert.eq(LC.resolveReceiveTheme2({ tagId: 'jiehun', title: '父亲葬礼' }, 'classic'), 'funeral', '标题葬礼→默认白事样式');
  assert.eq(LC.resolveReceiveTheme2({ tagId: 'baishi', title: '' }, 'blue'), 'funeral', '标签白事→白事样式');
  assert.eq(LC.resolveReceiveTheme2({ tagId: 'jiehun', title: '儿子婚礼' }, 'blue'), 'blue', '普通礼薄用所选样式');
  assert.eq(LC.resolveReceiveTheme2({ tagId: 'jiehun', title: '儿子婚礼' }, 'funeral'), 'funeral', '普通礼薄手选白事样式');
  assert.eq(LC.resolveReceiveTheme2({ tagId: 'jiehun', title: '儿子婚礼' }, 'nope'), 'classic', '非法样式回退经典');
  assert.eq(LC.resolveReceiveTheme('baishi', 'classic'), 'funeral', '旧签名保留兼容');
});

/* ---------- AT-2/AT-3 buildColumns 整本覆盖 ---------- */

test('AT 列构建：整本 midText 覆盖逐列；无覆盖时逐列按标签不回退', () => {
  const rows = [
    { id: '1', name: '张三', amountFen: 10000, tagId: 'jiehun' },
    { id: '2', name: '李四', amountFen: 20000, tagId: 'baishi' },
  ];
  const covered = LC.buildColumns(rows, { midText: '奠仪' });
  assert(covered.columns.slice(0, 2).every((c) => c.midText === '奠仪'), '整本覆盖：全列奠仪（送礼手选白事样式口径）');
  assert(covered.columns[0].midBlack, '奠仪列中段字黑色口径跟随');
  const plain = LC.buildColumns(rows, {});
  assert.eq(plain.columns[0].midText, '贺礼', '无覆盖：结婚记录贺礼');
  assert.eq(plain.columns[1].midText, '奠仪', '无覆盖：白事记录仍奠仪列（现状不回退）');
  const undef = LC.buildColumns(rows, { midText: undefined });
  assert.eq(undef.columns[0].midText, '贺礼', 'midText=undefined 等同无覆盖');
});

/* ---------- AT-4 OCR 竖排奠仪滤除 ---------- */

test('AT OCR 竖排：白事纸面印刷字「奠仪/奠儀」滤除，姓名金额不受影响', () => {
  const cols = [
    ['王建国', '奠仪', '伍佰元', 50000],
    ['李秀英', '奠儀', '贰佰元', 20000],
    ['刘大山', '奠仪', '壹仟元整', 100000],
  ];
  const dets = [];
  cols.forEach(([name, mid, amount], i) => {
    const x = 30 + i * 92;
    dets.push(det(name, x, 40, 30, 110));   // 顶部竖写姓名
    dets.push(det(mid, x, 170, 30, 44));    // 中段纸面印刷字（须滤除）
    dets.push(det(amount, x, 240, 30, 110)); // 下方竖写大写金额
  });
  const rows = tencentOcr.parseDetections(dets);
  assert.eq(rows.length, 3, '三列三笔：奠仪不单独成笔、不串列');
  assert.eq(rows.map((r) => r.name).join(','), '王建国,李秀英,刘大山', '姓名无奠仪残留');
  assert.eq(rows.map((r) => r.amountFen).join(','), '50000,20000,100000', '金额大写换算不受影响');
});

/* ---------- AT-6 卷轴贴合几何（六主题同一量测） ---------- */

test('AT 卷轴几何：6 主题 PNG 量测一致（88×836／帽 23+23／杆身 790×58）', () => {
  const g = LC.SCROLL_GEOM;
  assert.eq(g.IMG_W, 88, 'PNG 宽');
  assert.eq(g.IMG_H, 836, 'PNG 高');
  assert.eq(g.CAP_TOP, 23, '上帽组件高（行 0..22）');
  assert.eq(g.CAP_BOT, 23, '下帽组件高（行 813..835）');
  assert.eq(g.SHAFT_TOP, 23, '杆身起行');
  assert.eq(g.SHAFT_H, 790, '杆身高（行 23..812）');
  assert.eq(g.SHAFT_X, 15, '杆身实绘左缘（两侧透明各 15）');
  assert.eq(g.SHAFT_W, 58, '杆身实绘宽');
  assert.eq(g.CAP_TOP + g.SHAFT_H + g.CAP_BOT, g.IMG_H, '帽＋杆身＋帽 = 整图高');
  for (const t of LC.THEME_LIST) {
    const p = path.join(__dirname, '..', 'miniprogram', t.scrollImg.replace(/^\//, ''));
    assert(fs.existsSync(p), `主题 ${t.id} 卷轴图应存在：${t.scrollImg}`);
  }
});

test('AT 卷轴定位（AV 改锚后）：基准纸高 294 下分界线对齐纸面、帽子探出、杆缘贴纸缘（间隙 0）', () => {
  // AV 批（用户 2026-10-27）：锚点由「杆身 [23,813)」改为逐主题「分界横线」——
  // 缺省（classic）锚 41/795：k = 294/754。本测试随改锚更新为分界线对齐断言，
  // 六主题逐组断言见 test-batch-av-behavior；原 PNG 尺寸/覆盖断言在上一测试保留。
  const paperH = LC.SPEC.PAPER_H; // 294
  const L = LC.scrollLayout(paperH);
  const g = LC.SCROLL_GEOM;
  const lines = g.LINES_DEFAULT;
  const k = paperH / (lines.bottom - lines.top);
  // ① 整图高 = 纸高 + 上下探出；顶偏移 = −上探出量
  assert(near(L.imgH - paperH, L.capTopPx + L.capBotPx), '整图高超出纸高恰为上下探出之和');
  assert(near(L.top, -L.capTopPx), '图顶偏移 = −上探出量');
  // ② 上下分界横线与纸面上下边对齐（误差 <1px）
  assert(Math.abs(L.top + lines.top * k) < 1, '上分界线 = 纸顶');
  assert(Math.abs(L.top + lines.bottom * k - paperH) < 1, '下分界线 = 纸底');
  // ③ 杆身实绘左右缘与槽位（纸缘）重合，间隙 0
  assert(near(L.left + g.SHAFT_X * k, 0), '杆身实绘左缘 = 槽位左缘');
  assert(near(L.left + (g.SHAFT_X + g.SHAFT_W) * k, L.slotW), '杆身实绘右缘 = 槽位右缘（纸缘）');
  // 基准画布具体数字（AV 量测表口径：五杆同锚 41/795）
  assert.eq(L.capTopPx, 15.99, '上探出 15.99（帽＋分界线以上图段）');
  assert.eq(L.capBotPx, 15.99, '下探出 15.99');
  assert(near(L.slotW, 22.62, 0.001), '槽位宽 = 杆身实绘宽 22.62');
  assert(near(L.left, -5.85, 0.001), '图左移 −5.85（透明带移出槽外）');
  assert(L.capTopPx < LC.SPEC.MARGIN_V, '上探出小于上留白 48，不顶屏幕边');
  assert(L.capBotPx < LC.SPEC.MARGIN_B, '下探出小于下留白 30，不顶屏幕边');
  // 等比无变形：宽高同 k
  assert(near(L.imgW / g.IMG_W, L.imgH / g.IMG_H, 0.001), '整图宽高同比例缩放');
});
