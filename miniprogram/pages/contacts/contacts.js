/**
 * 礼单簿 · 亲友录（阶段2 2A）
 * 拼音分组；搜索框 + 取消；点姓名弹出半屏（往来记录/修改姓名/删除姓名）；
 * 删除姓名二次确认，写明"将同时删除 X 条收礼、Y 条送礼记录，删除后无法恢复"。
 */
const dataService = require('../../services/data-service.js');

function pinyinInitial(name) {
  // 演示期简易分组：取首字，按常见姓氏映射；未知归 '#'
  const first = (name || '').charAt(0);
  const map = {
    张: 'Z', 李: 'L', 王: 'W', 赵: 'Z', 刘: 'L', 陈: 'C', 杨: 'Y', 黄: 'H',
    周: 'Z', 吴: 'W', 徐: 'X', 孙: 'S', 马: 'M', 朱: 'Z', 胡: 'H', 郭: 'G',
    何: 'H', 罗: 'L', 高: 'G', 郑: 'Z', 梁: 'L', 谢: 'X', 宋: 'S', 唐: 'T',
  };
  return map[first] || '#';
}

Page({
  data: {
    groups: [],
    keyword: '',
    tipText: '小技巧：点击姓名可查询来往记录哦～',
    sheetOpen: false,
    sheetName: '',
    sheetId: '',
    delModal: false,
    delInfo: null,
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
    const by = {};
    list.forEach((c) => {
      const k = pinyinInitial(c.name);
      (by[k] = by[k] || []).push(c);
    });
    const groups = Object.keys(by).sort().map((k) => ({ key: k, items: by[k] }));
    this.setData({ groups });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.reload();
  },

  onCancelSearch() {
    this.setData({ keyword: '' });
    this.reload();
  },

  openSheet(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ sheetOpen: true, sheetId: id, sheetName: name });
  },

  closeSheet() {
    this.setData({ sheetOpen: false });
  },

  goWanglai() {
    this.closeSheet();
    wx.showToast({ title: '往来竖线树（阶段2B）', icon: 'none' });
  },

  goEdit() {
    const id = this.data.sheetId;
    this.closeSheet();
    wx.navigateTo({ url: `/pages/contact-edit/contact-edit?id=${id}` });
  },

  async onDelete() {
    // 第一步：先查影响条数
    try {
      const info = await dataService.deleteContact(this.data.sheetId, false);
      this.setData({
        sheetOpen: false,
        delModal: true,
        delInfo: {
          name: this.data.sheetName,
          receiveCount: info.receiveCount || 0,
          giftCount: info.giftCount || 0,
        },
      });
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },

  onCancelDel() {
    this.setData({ delModal: false, delInfo: null });
  },

  async onConfirmDel() {
    try {
      await dataService.deleteContact(this.data.sheetId, true);
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.reload();
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this.setData({ delModal: false, delInfo: null });
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/contact-add/contact-add' });
  },
});
