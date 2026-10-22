/**
 * 礼单簿 · 小喇叭长文字慢速左滚判定（2026-10-22 任务AB 第 8 项，用户第三次改口径）
 *
 * 规格：小喇叭常驻不闪烁（淡黄底保留，× 关闭仅本次，见 horn-state.js）；
 * 文字放得下 → 静态居左（过长省略）；放不下 → 缓慢向左滚动（marquee，
 * 约 30px/秒，CSS 动画双份文字无缝循环，见 app.wxss .horn-track）。
 * 本模块只做纯计算：按字宽估算文字像素宽，超可用宽才滚，并给出动画时长。
 * 时长 =（文字宽 + 两份文字间隔 48px）/ 30px每秒，与 CSS 的 translateX(-50%)
 * 循环距离（恰一份文字宽 + 间隔）对应，保证速度恒定与字数无关。
 */

const GAP_PX = 48;      // 两份文字之间的间隔（与 wxss .horn-cell 的 padding-right 一致）
const SPEED_PX_S = 30;  // 滚动速度：约 30px/秒（慢）

/** 估算文字像素宽：全角字按字号计，半角（数字/字母/标点）按 0.55 倍计 */
function estimateWidth(text, fontPx = 12) {
  let w = 0;
  for (const ch of String(text || '')) {
    w += ch.codePointAt(0) > 0xFF ? fontPx : fontPx * 0.55;
  }
  return Math.round(w);
}

/**
 * @param text 提示文字
 * @param opts.avail 可用宽（px，缺省 290 ≈ 375 屏宽减喇叭图标/关闭叉/页边距）
 * @param opts.fontPx 字号（px，缺省 12）
 * @returns {{run:boolean, dur:number, width:number}} run=是否滚动，dur=动画时长（秒）
 */
function hornMarquee(text, opts = {}) {
  const avail = opts.avail || 290;
  const width = estimateWidth(text, opts.fontPx || 12);
  if (width <= avail) return { run: false, dur: 0, width };
  const dur = Math.max(4, Math.round(((width + GAP_PX) / SPEED_PX_S) * 10) / 10);
  return { run: true, dur, width };
}

module.exports = { hornMarquee, estimateWidth, GAP_PX, SPEED_PX_S };
