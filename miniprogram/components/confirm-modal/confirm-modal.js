/**
 * 居中确认弹窗（含半透明遮罩，全产品统一，v3.1 第三章第1条）
 * 属性：show 是否显示；title 标题；content 内容（支持影响范围说明）；
 *       confirmText 确认按钮文（默认"删除"）；danger 确认按钮是否红色（默认 true）
 * 事件：confirm() 点确认；cancel() 点取消/遮罩
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '确认' },
    content: { type: String, value: '' },
    confirmText: { type: String, value: '删除' },
    cancelText: { type: String, value: '取消' },
    danger: { type: Boolean, value: true },
  },
  methods: {
    onConfirm() {
      this.triggerEvent('confirm');
    },
    onCancel() {
      this.triggerEvent('cancel');
    },
    // 阻止遮罩下层滚动穿透
    noop() {},
  },
});
