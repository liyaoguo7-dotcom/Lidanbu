/**
 * 小喇叭提示条（v3.1 第一章：很小的小喇叭配动态小字，提示操作）
 * 属性：text 提示文字；hornKey 关闭状态键（缺省 'tipbar'）
 * 统一规格（2026-10-22 任务AB 第 8 项，用户第三次改口径）：淡黄底、常驻不闪烁；
 * 文字放得下静态居左（过长省略），放不下缓慢向左滚动（约 30px/秒，判定与时长
 * 走 services/horn-marquee.js）；右侧 × 关闭后本次打开期间不再显示
 * （状态在 services/horn-state.js 只存内存，冷启动恢复）。
 */
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');

Component({
  properties: {
    text: { type: String, value: '' },
    hornKey: { type: String, value: 'tipbar' },
  },
  data: {
    hidden: false,
    hornRun: false,
    hornDur: 0,
  },
  observers: {
    text(v) { this._syncHorn(v); },
  },
  lifetimes: {
    attached() {
      this.setData({ hidden: hornState.isDismissed(this.data.hornKey) });
      this._syncHorn(this.data.text);
    },
  },
  methods: {
    _syncHorn(text) {
      const m = hornMarquee(text || '', { fontPx: 14, avail: 284 });
      this.setData({ hornRun: m.run, hornDur: m.dur });
    },
    onClose() {
      hornState.dismiss(this.data.hornKey);
      this.setData({ hidden: true });
    },
  },
});
