/**
 * AV批行为测试：卷轴对齐改锚——分界横线对齐纸面（用户 2026-10-27 看 AU 预览后亲定）。
 * 背景：AT-6 旧锚以杆身 [23,813) 对齐纸面，但每根杆在帽下都有一条醒目的分界横线
 * （杆身装饰环/纹带的外缘），旧锚下它落在纸面跨度内约 6.7px（白事纹带上沿约 4.1px），
 * 纸边没压在线上。AV 改为：上下分界线分别与纸面上下边精确对齐，帽子探出为派生值。
 * 锚点逐张量测（alpha/均值色行扫描＋tools/draw-scrolls.py 参数互证）：
 * 五杆（classic/blue/pear/bamboo/cloud）环带行 41..52 / 783..794 → 线 41 / 795；
 * funeral 纹带行 34..103 / 732..801 → 线 34 / 802。本文件含零依赖 PNG 解码做像素互证。
 * AW 再改锚（2026-10-27，用户看 AV 预览后亲定）：用户判定 AV 的环带外缘（41/795）
 * 是"内侧横线"，改用外侧横线对齐——五杆锚点改为上环带下缘 52／下环带上缘 783
 * （整条环带推到纸面跨度之外）；funeral 黑杆用户明说不动，保持 34/802。
 * 故本文件锚点表与基准数字已按 AW 更新（逐条注明），像素互证（四条带缘都在）
 * 不受影响、原样保留——AW 新锚用的 52/783 两条缘正在互证范围内。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { test, assert } = require('./fw');

const LC = require('../miniprogram/pages/landscape/landscape-core.js');

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

/* ---------- 极简 PNG 解码（仅支持本仓库资产格式：RGBA8、非隔行，同 AU 测试） ---------- */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  assert(buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47, `${file} 应为 PNG`);
  let off = 8;
  let w = 0; let h = 0; let bitDepth = 0; let colorType = 0; let interlace = 1;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  assert.eq(bitDepth, 8, `${file} 位深应为 8`);
  assert.eq(colorType, 6, `${file} 应为 RGBA`);
  assert.eq(interlace, 0, `${file} 应为非隔行`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (i >= bpp && prev) ? prev[i - bpp] : 0;
      let v = row[i];
      if (ft === 1) v = (v + a) & 0xff;
      else if (ft === 2) v = (v + b) & 0xff;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (ft === 4) {
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        v = (v + pr) & 0xff;
      }
      cur[i] = v;
    }
  }
  return { w, h, px: (x, y) => {
    const i = (y * w + x) * 4;
    return { r: out[i], g: out[i + 1], b: out[i + 2], a: out[i + 3] };
  } };
}

const scrollFile = (t) => path.join(__dirname, '..', 'miniprogram', t.scrollImg.replace(/^\//, ''));

/** 杆身 x∈[15,72] 均值色（alpha>10 的像素） */
function shaftMean(img, y) {
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let x = 15; x <= 72; x++) {
    const p = img.px(x, y);
    if (p.a > 10) { r += p.r; g += p.g; b += p.b; n++; }
  }
  return n ? [r / n, g / n, b / n] : null;
}
function shaftDiff(img, y) {
  const a = shaftMean(img, y); const b = shaftMean(img, y + 1);
  if (!a || !b) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function maxDiffIn(img, lo, hi) {
  let m = 0;
  for (let y = lo; y <= hi; y++) m = Math.max(m, shaftDiff(img, y));
  return m;
}
/** 某行实绘横向范围（alpha>10） */
function rowExtent(img, y) {
  let minX = 999; let maxX = -1;
  for (let x = 0; x < img.w; x++) {
    if (img.px(x, y).a > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  return [minX, maxX];
}

/* ---------- 锚点表：逐主题量测值 ---------- */

test('AW 锚点表：六主题分界线行号（五杆外侧横线 52/783、白事保持 AV 锚 34/802）', () => {
  const L = LC.SCROLL_GEOM.LINES;
  for (const id of ['classic', 'blue', 'pear', 'bamboo', 'cloud']) {
    // AW 改锚：41（上环带上沿）是用户判定的"内侧横线"，改取上环带下缘 52 为外侧横线
    assert.eq(L[id].top, 52, `${id} 上分界线 = 上环带下缘 52（AW 外侧横线）`);
    assert.eq(L[id].bottom, 783, `${id} 下分界线 = 下环带上缘 783（AW 外侧横线）`);
  }
  assert.eq(L.funeral.top, 34, 'funeral 上分界线 = 纹带上沿亮线 34（AW 不动）');
  assert.eq(L.funeral.bottom, 802, 'funeral 下分界线 = 纹带下沿亮线 802（AW 不动）');
  // 镜像关系：funeral 严格对称；五杆 AW 锚差 1 行（52 的镜像 784 vs 下环带上缘 783，
  // 环带为闭区间含端点的量测固有差），容差 1 行并以此断言锁住"至多差 1 行"
  for (const t of LC.THEME_LIST) {
    const a = L[t.id];
    assert(Math.abs(a.top - (LC.SCROLL_GEOM.IMG_H - a.bottom)) <= 1,
      `${t.id} 分界线上下近镜像（差 ${Math.abs(a.top - (LC.SCROLL_GEOM.IMG_H - a.bottom))} 行，应 ≤1）`);
    assert(a.bottom - a.top < LC.SCROLL_GEOM.SHAFT_H, `${t.id} 分界跨度小于杆身跨度（帽子探出比旧锚更多）`);
  }
});

/* ---------- 定位公式：六主题逐组断言 ---------- */

for (const t of LC.THEME_LIST) {
  test(`AV 卷轴定位（${t.id}）：分界线对齐纸面上下边、探出派生、杆缘零间隙`, () => {
    const paperH = LC.SPEC.PAPER_H; // 294
    const g = LC.SCROLL_GEOM;
    const lines = g.LINES[t.id];
    const k = paperH / (lines.bottom - lines.top);
    const L = LC.scrollLayout(paperH, t.id);
    assert.eq(L.lineTop, lines.top, '返回值应带本次锚点 top');
    assert.eq(L.lineBottom, lines.bottom, '返回值应带本次锚点 bottom');
    // 分界线映射到纸顶/纸底，误差 <1px（基准画布）
    assert(Math.abs(L.top + lines.top * k) < 1, `上分界线落纸顶（实际 ${L.top + lines.top * k}）`);
    assert(Math.abs(L.top + lines.bottom * k - paperH) < 1, `下分界线落纸底（实际 ${L.top + lines.bottom * k - paperH}）`);
    // 探出量为派生值：上 = 线以上图段 × k；下 = 线以下图段 × k；整图高 = 纸高＋两探出
    assert(near(L.capTopPx, lines.top * k), '上探出 = lineTop × k');
    assert(near(L.capBotPx, (g.IMG_H - lines.bottom) * k), '下探出 = (图高 − lineBottom) × k');
    assert(near(L.imgH - paperH, L.capTopPx + L.capBotPx), '整图高超出纸高恰为两探出之和');
    assert(near(L.top, -L.capTopPx), '图顶偏移 = −上探出量');
    // 不顶屏幕边（基准画布留白：上 48 / 下 30）
    assert(L.capTopPx < LC.SPEC.MARGIN_V, `上探出 ${L.capTopPx} < 上留白 48`);
    assert(L.capBotPx < LC.SPEC.MARGIN_B, `下探出 ${L.capBotPx} < 下留白 30`);
    // 杆缘贴纸缘零间隙、等比无变形（口径不变，只是 k 改由分界跨度算）
    assert(near(L.left + g.SHAFT_X * k, 0), '杆身实绘左缘 = 槽位左缘');
    assert(near(L.left + (g.SHAFT_X + g.SHAFT_W) * k, L.slotW), '杆身实绘右缘 = 槽位右缘（纸缘）');
    assert(near(L.imgW / g.IMG_W, L.imgH / g.IMG_H, 0.001), '整图宽高同比例缩放');
    // 帽子比 AT 旧锚（8.56）探出更多——用户「帽子再往上提」的方向性断言
    assert(L.capTopPx > 8.56 && L.capBotPx > 8.56, `探出应大于旧锚 8.56（实际 ${L.capTopPx}/${L.capBotPx}）`);
  });
}

test('AW 基准数字：五杆探出 20.91/21.32、白事探出 13.02 不变（基准画布 294）', () => {
  const c = LC.scrollLayout(LC.SPEC.PAPER_H, 'classic');
  assert.eq(c.capTopPx, 20.91, 'classic 上探出 52×294/731 = 20.91（AW 外侧横线锚）');
  assert.eq(c.capBotPx, 21.32, 'classic 下探出 53×294/731 = 21.32（AW 外侧横线锚）');
  assert(near(c.slotW, 23.33, 0.001), 'classic 槽位宽 23.33');
  assert(near(c.left, -6.03, 0.001), 'classic 图左移 −6.03');
  const f = LC.scrollLayout(LC.SPEC.PAPER_H, 'funeral');
  assert.eq(f.capTopPx, 13.02, 'funeral 上探出 34×294/768 = 13.02（AW 不动）');
  assert.eq(f.capBotPx, 13.02, 'funeral 下探出 13.02（AW 不动）');
});

test('AV 缺省兼容：不带主题 = LINES_DEFAULT（与 classic 同锚）；未知主题回退缺省', () => {
  const d = LC.scrollLayout(LC.SPEC.PAPER_H);
  const c = LC.scrollLayout(LC.SPEC.PAPER_H, 'classic');
  assert.eq(d.top, c.top, '缺省 top 与 classic 一致');
  assert.eq(d.imgH, c.imgH, '缺省 imgH 与 classic 一致');
  assert.eq(d.lineTop, LC.SCROLL_GEOM.LINES_DEFAULT.top, '缺省锚取 LINES_DEFAULT');
  const u = LC.scrollLayout(LC.SPEC.PAPER_H, 'no-such-theme');
  assert.eq(u.top, c.top, '未知主题回退缺省锚');
  // 非基准纸高同样按线对齐（如实际窗口纸高 300）
  const L = LC.scrollLayout(300, 'funeral');
  const lines = LC.SCROLL_GEOM.LINES.funeral;
  const k = 300 / (lines.bottom - lines.top);
  assert(Math.abs(L.top + lines.top * k) < 1, '纸高 300 时上分界线仍落纸顶');
  assert(Math.abs(L.top + lines.bottom * k - 300) < 1, '纸高 300 时下分界线仍落纸底');
});

/* ---------- 像素互证：锚点线确为图上环带/纹带外缘 ---------- */

const RING_THEMES = ['classic', 'blue', 'pear', 'bamboo', 'cloud'];
for (const id of RING_THEMES) {
  test(`AV 像素互证（${id}）：环带两缘在行 41/52 与 783/794 处有强横向分界`, () => {
    const img = decodePng(scrollFile(LC.THEMES[id]));
    assert(maxDiffIn(img, 38, 45) > 40, `${id} 上环带上沿（≈41）应有强色界`);
    assert(maxDiffIn(img, 49, 55) > 40, `${id} 上环带下沿（≈52）应有强色界`);
    assert(maxDiffIn(img, 780, 787) > 40, `${id} 下环带上沿（≈783）应有强色界`);
    assert(maxDiffIn(img, 792, 798) > 40, `${id} 下环带下沿（≈794）应有强色界`);
  });
}

for (const id of ['blue', 'pear', 'bamboo']) {
  test(`AV 像素互证（${id}）：雕环轮廓外扩恰为行 41..52 / 783..794`, () => {
    const img = decodePng(scrollFile(LC.THEMES[id]));
    const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
    assert(eq(rowExtent(img, 40), [15, 72]), `${id} 行 40 仍是杆身宽`);
    assert(rowExtent(img, 41)[0] < 15, `${id} 行 41 起轮廓外扩（环带上沿）`);
    assert(rowExtent(img, 52)[0] < 15, `${id} 行 52 仍在环带内`);
    assert(eq(rowExtent(img, 53), [15, 72]), `${id} 行 53 复原杆身宽`);
    assert(eq(rowExtent(img, 782), [15, 72]), `${id} 行 782 仍是杆身宽`);
    assert(rowExtent(img, 783)[0] < 15, `${id} 行 783 起轮廓外扩（下环带上沿）`);
    assert(rowExtent(img, 794)[0] < 15, `${id} 行 794 仍在环带内`);
    assert(eq(rowExtent(img, 795), [15, 72]), `${id} 行 795 复原杆身宽（下分界线 = 795）`);
  });
}

test('AV 像素互证（funeral）：纹带两缘在行 34/103 与 732/801 处有强横向分界', () => {
  const img = decodePng(scrollFile(LC.THEMES.funeral));
  assert(maxDiffIn(img, 30, 37) > 40, 'funeral 上纹带上沿（≈34）应有强色界');
  assert(maxDiffIn(img, 99, 106) > 40, 'funeral 上纹带下沿（≈103）应有强色界');
  assert(maxDiffIn(img, 728, 735) > 40, 'funeral 下纹带上沿（≈732）应有强色界');
  assert(maxDiffIn(img, 798, 805) > 40, 'funeral 下纹带下沿（≈801）应有强色界');
  // 纹带之外（杆身中段）不应有同等强度的横线，佐证锚点取的是带外缘而非别处
  assert(maxDiffIn(img, 300, 400) < 20, 'funeral 杆身中段无强横线');
});
