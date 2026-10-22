/**
 * 小喇叭提示条（v3.1 第一章：很小的小喇叭配动态小字，提示操作）
 * 属性：text 提示文字；hornKey 关闭状态键（缺省 'tipbar'）
 * 统一规格（2026-10-22 用户定版）：不滚动、慢速柔和闪烁；文字过长默认单行省略，
 * 点文字展开左右滑动看全文；右侧 × 关闭后本次打开期间不再显示
 * （状态在 services/horn-state.js 只存内存，冷启动恢复）。
 */
const hornState = require('../../services/horn-state.js');

Component({
  properties: {
    text: { type: String, value: '' },
    hornKey: { type: String, value: 'tipbar' },
  },
  data: {
    hidden: false,
    expanded: false,
  },
  lifetimes: {
    attached() {
      this.setData({ hidden: hornState.isDismissed(this.data.hornKey) });
    },
  },
  methods: {
    onTapText() {
      this.setData({ expanded: !this.data.expanded });
    },
    onClose() {
      hornState.dismiss(this.data.hornKey);
      this.setData({ hidden: true });
    },
  },
});
