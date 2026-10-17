/**
 * 带"取消"的搜索框（v3.1 第三章第6条）
 * 事件：search(value) 输入确认搜索；cancel() 点取消；input(value) 输入中
 */
Component({
  properties: {
    placeholder: { type: String, value: '搜索' },
    value: { type: String, value: '' },
  },
  data: {
    focused: false,
  },
  methods: {
    onInput(e) {
      this.setData({ value: e.detail.value });
      this.triggerEvent('input', { value: e.detail.value });
    },
    onFocus() {
      this.setData({ focused: true });
    },
    onConfirm() {
      this.triggerEvent('search', { value: this.data.value });
    },
    onCancel() {
      this.setData({ value: '', focused: false });
      this.triggerEvent('cancel');
    },
  },
});
