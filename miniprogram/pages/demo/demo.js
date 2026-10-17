/** 组件示例页（T0.2）：展示全部 7 个通用组件的用法 */
Page({
  data: {
    showModal: false,
    searchValue: '',
    selectedTag: '',
    selectedDate: '',
  },

  // 搜索框
  onSearchInput(e) {
    this.setData({ searchValue: e.detail.value });
  },
  onSearchConfirm(e) {
    wx.showToast({ title: `搜索：${e.detail.value}`, icon: 'none' });
  },
  onSearchCancel() {
    this.setData({ searchValue: '' });
    wx.showToast({ title: '已取消搜索', icon: 'none' });
  },

  // 确认弹窗
  openModal() {
    this.setData({ showModal: true });
  },
  onModalConfirm() {
    this.setData({ showModal: false });
    wx.showToast({ title: '已确认', icon: 'none' });
  },
  onModalCancel() {
    this.setData({ showModal: false });
  },

  // 红色＋按钮
  onAddTap() {
    wx.showToast({ title: '点击了＋按钮', icon: 'none' });
  },

  // 空状态
  onEmptyAction() {
    wx.showToast({ title: '点击查看示例（占位）', icon: 'none' });
  },

  // 日期选择
  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value });
  },

  // 标签选择
  onTagChange(e) {
    this.setData({ selectedTag: e.detail.name });
  },
});
