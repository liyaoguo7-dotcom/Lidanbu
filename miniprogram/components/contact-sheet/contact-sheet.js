/**
 * 添加亲友（底部半屏组件）
 * 属性：show 是否显示
 * 事件：confirm({ name, remark }) 点"添加"（姓名为空会先拦）；cancel() 点遮罩/取消
 * 由调用方负责真正写库（dataService.createContact），并处理重名提醒。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
  },
  data: {
    name: '',
    remark: '',
  },
  observers: {
    show(v) {
      if (v) this.setData({ name: '', remark: '' }); // 每次打开清空
    },
  },
  methods: {
    onNameInput(e) { this.setData({ name: e.detail.value }); },
    onRemarkInput(e) { this.setData({ remark: e.detail.value }); },
    onCancel() { this.triggerEvent('cancel'); },
    onConfirm() {
      const name = (this.data.name || '').trim();
      if (!name) {
        wx.showToast({ title: '请填写姓名', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm', { name, remark: (this.data.remark || '').trim() });
    },
    noop() {},
  },
});
