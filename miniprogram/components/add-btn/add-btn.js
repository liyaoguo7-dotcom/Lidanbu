/** 红色＋按钮（底部中间，全局统一） */
Component({
  properties: {
    // 无障碍文案
    ariaLabel: { type: String, value: '新增' },
  },
  methods: {
    onTap() {
      this.triggerEvent('tap');
    },
  },
});
