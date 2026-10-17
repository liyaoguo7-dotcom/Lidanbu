/**
 * 礼单簿 · 选择亲友（阶段2 2A）
 * 搜索框 + 右侧"取消"；小喇叭提示；列表同亲友录样式；
 * 底部中间＋（去新增亲友，返回后继续选）；选中后回传。
 */
const dataService = require('../../services/data-service.js');
const { wxStorage, savePick } = require('../../services/form-state.js');

Page({
  data: {
    contacts: [],
    keyword: '',
    tipText: '若亲友姓名不在列表中，请点击下方红色按钮添加',
  },

  async onLoad() {
    await dataService.init();
  },

  async onShow() {
    await this.reload();
  },

  async reload() {
    const kw = (this.data.keyword || '').trim();
    const list = kw
      ? await dataService.searchContacts(kw)
      : await dataService.listContacts();
    this.setData({ contacts: list });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.reload();
  },

  onCancelSearch() {
    this.setData({ keyword: '' });
    this.reload();
  },

  onPick(e) {
    const { id, name } = e.currentTarget.dataset;
    savePick(wxStorage(), { contactId: id, contactName: name });
    wx.navigateBack();
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/contact-add/contact-add?from=choose' });
  },
});
