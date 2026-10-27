/**
 * AU批行为测试：三款卷轴杆按用户参考图重绘并替换现有主题卷轴图
 * （红款→classic 传统经典、金款→cloud 祥云金、墨黑款→funeral 白事）。
 * 用户定版：只取参考图的颜色/纹路/帽型；主题仍 6 款、名称/纸面/色值全不动；
 * 尺寸粗细按现行几何（88×836、帽 23＋杆身 790＋帽 23、杆身实绘 [15,72]、不出 [11,76]）。
 * 本文件含一个零依赖 PNG 解码器（zlib 内置），对六张杆图做逐行 alpha 量测。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { test, assert } = require('./fw');

const LC = require('../miniprogram/pages/landscape/landscape-core.js');

/* ---------- 极简 PNG 解码（仅支持本仓库资产格式：RGBA8、非隔行） ---------- */
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

/* ---------- 主题结构：仍 6 款、名称/映射/色值全不动 ---------- */

test('AU 主题仍 6 款：顺序、名称、卷轴映射不变（新杆是替换图、不是新主题）', () => {
  assert.eq(LC.THEME_LIST.map((t) => t.id).join(','), 'classic,blue,pear,cloud,bamboo,funeral', '主题顺序不变');
  assert.eq(LC.THEME_LIST.map((t) => t.name).join(','), '传统经典,淡蓝水波纹,梨花白,祥云金,竹青,白事', '主题名称不变');
  for (const t of LC.THEME_LIST) {
    assert.eq(t.scrollImg, `/assets/scrolls/scroll-${t.id}.png`, `${t.id} 卷轴引用不变（同名覆盖）`);
  }
  // 色值抽查：本批不动任何主题色
  assert.eq(LC.THEMES.classic.paperBg, '#FFF8F2', 'classic 纸面色不变');
  assert.eq(LC.THEMES.classic.midColor, '#9E2A22', 'classic 贺礼色不变');
  assert.eq(LC.THEMES.cloud.paperBg, '#FDF8EC', 'cloud 纸面色不变');
  assert.eq(LC.THEMES.cloud.midColor, '#8A6520', 'cloud 贺礼色不变');
  assert.eq(LC.THEMES.funeral.paperBg, '#FFFFFF', 'funeral 纸面色不变');
  assert.eq(LC.THEMES.funeral.noRed, true, 'funeral 无红规则不变');
});

/* ---------- 六图同几何量测（逐行 alpha 扫描） ---------- */

test('AU 卷轴量测：6 主题 PNG 同几何（88×836／帽 23+杆身 790+帽 23／杆身实绘 [15,72]／不出 [11,76]）', () => {
  for (const t of LC.THEME_LIST) {
    const img = decodePng(scrollFile(t));
    assert.eq(img.w, 88, `${t.id} 图宽 88`);
    assert.eq(img.h, 836, `${t.id} 图高 836`);
    for (let y = 0; y < 836; y++) {
      let minX = 999; let maxX = -1; let hole = false;
      for (let x = 0; x < 88; x++) {
        const a = img.px(x, y).a;
        if (a > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
        if (y >= 23 && y <= 812 && x >= 15 && x <= 72 && a <= 10) hole = true;
      }
      assert(maxX >= 0, `${t.id} 行 ${y} 不应整行透明`);
      assert(minX >= 11 && maxX <= 76, `${t.id} 行 ${y} 实绘不出 [11,76]（实际 ${minX}..${maxX}）`);
      if (y >= 23 && y <= 812) {
        assert(!hole, `${t.id} 杆身行 ${y} 在 [15,72] 内不应有透明空洞`);
        assert(minX <= 15 && maxX >= 72, `${t.id} 杆身行 ${y} 应覆盖 [15,72]（实际 ${minX}..${maxX}）`);
      }
    }
  }
});

/* ---------- 三张新杆配色抽样（取自参考图：颜色是提取三要素之一） ---------- */

test('AU 新杆配色：classic 朱红杆身＋深红帽（红款）', () => {
  const img = decodePng(scrollFile(LC.THEMES.classic));
  const shaft = img.px(43, 400);
  assert(shaft.r > 150 && shaft.r - shaft.g > 80 && shaft.r - shaft.b > 80,
    `classic 杆身应为朱红（实际 ${shaft.r},${shaft.g},${shaft.b}）`);
  const cap = img.px(43, 8);
  assert(cap.r > 110 && cap.r - cap.b > 60 && cap.r < shaft.r,
    `classic 帽应为更深的红（实际 ${cap.r},${cap.g},${cap.b}）`);
});

test('AU 新杆配色：cloud 米金杆身＋金帽（金款）', () => {
  const img = decodePng(scrollFile(LC.THEMES.cloud));
  const shaft = img.px(43, 400);
  assert(shaft.r > 235 && shaft.g > 220 && shaft.b > 185,
    `cloud 杆身应为米金浅色（实际 ${shaft.r},${shaft.g},${shaft.b}）`);
  const cap = img.px(43, 14);
  assert(cap.r > 190 && cap.g > 140 && cap.r - cap.b > 60,
    `cloud 帽应为金色（实际 ${cap.r},${cap.g},${cap.b}）`);
});

test('AU 新杆配色：funeral 炭黑杆身＋深灰球帽（墨黑款）', () => {
  const img = decodePng(scrollFile(LC.THEMES.funeral));
  const shaft = img.px(43, 400);
  assert(shaft.r < 100 && shaft.g < 100 && shaft.b < 110 && Math.abs(shaft.r - shaft.b) <= 12,
    `funeral 杆身应为近中性炭黑（实际 ${shaft.r},${shaft.g},${shaft.b}）`);
  const ball = img.px(43, 8); // 球体本体（避开顶部高光点）
  assert(Math.max(ball.r, ball.g, ball.b) < 135 && Math.max(ball.r, ball.g, ball.b) > 30,
    `funeral 球帽应为深灰（实际 ${ball.r},${ball.g},${ball.b}）`);
  const hi = img.px(43, 5); // 高光点：仍是中性灰、不许漂白
  assert(Math.max(hi.r, hi.g, hi.b) < 170 && Math.abs(hi.r - hi.b) <= 12,
    `funeral 球帽高光应为中性灰（实际 ${hi.r},${hi.g},${hi.b}）`);
});
