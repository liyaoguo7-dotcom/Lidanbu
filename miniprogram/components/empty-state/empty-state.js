/**
 * 空状态（居中：淡色图标 + 淡色文字 + 可选操作）
 * 属性：iconText 图标占位字符；tip 提示文字；actionText 操作按钮文（为空则不显示）
 * 事件：action() 点操作按钮
 */
Component({
  properties: {
    iconText: { type: String, value: '📁' },
    tip: { type: String, value: '还没有记录' },
    actionText: { type: String, value: '' },
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
