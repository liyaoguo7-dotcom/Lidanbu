/**
 * 修改亲友信息（底部面板组件，约 80vh）
 * 属性：show 是否显示；initName/initRemark 打开时回填的当前值
 * 事件：confirm({ name, remark }) 点"修改"（姓名为空会先拦）；cancel() 点遮罩
 * 由调用方负责真正写库（dataService.updateContact）。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    initName: { type: String, value: '' },
    initRemark: { type: String, value: '' },
  },
  data: {
    name: '',
    remark: '',
  },
  observers: {
    'show, initName, initRemark': function (show, initName, initRemark) {
      if (show) this.setData({ name: initName || '', remark: initRemark || '' });
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
