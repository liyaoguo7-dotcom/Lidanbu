/**
 * 礼单簿 · 亲友录（阶段2 2A）
 * 拼音分组；搜索框 + 取消；点姓名弹出半屏（往来记录/修改姓名/删除姓名）；
 * 删除姓名二次确认，写明"将同时删除 X 条收礼、Y 条送礼记录，删除后无法恢复"。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');

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
    hornOff: false, hornRun: false, hornDur: 0, // 小喇叭：关闭（本次打开期间）/长文字慢速左滚（任务AB）
    groups: [],
    keyword: '',
    tipText: '小技巧：点击姓名可查询来往记录哦～',
    sheetOpen: false,
    sheetName: '',
    sheetId: '',
    delModal: false,
    delContent: '',
    addSheetOpen: false,
    editSheetOpen: false,
    editName: '',
    editRemark: '',
  },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('contacts'); this.setData({ hornOff: true }); },

  async onLoad() {
    this.setData({ hornOff: hornState.isDismissed('contacts') }); this._syncHorn();
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
    const id = this.data.sheetId;
    this.closeSheet();
    if (id) {
      wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${id}` });
    }
  },

  goEdit() {
    const id = this.data.sheetId;
    this.setData({ sheetOpen: false });
    // 取出当前姓名/备注，回填到半屏
    dataService.listContacts().then((list) => {
      const c = list.find((x) => x._id === id) || {};
      this.setData({
        editName: c.name || this.data.sheetName,
        editRemark: c.remark || '',
        editSheetOpen: true,
      });
    }).catch(() => {
      this.setData({ editName: this.data.sheetName, editRemark: '', editSheetOpen: true });
    });
  },

  onEditCancel() {
    this.setData({ editSheetOpen: false });
  },

  async onEditConfirm(e) {
    const { name, remark } = e.detail;
    try {
      await dataService.updateContact(this.data.sheetId, { name, remark });
      this.setData({ editSheetOpen: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.reload();
    } catch (err) {
      wx.showModal({ title: '提示', content: err.message, showCancel: false });
    }
  },

  async onDelete() {
    // 第一步：先查影响条数
    try {
      const info = await dataService.deleteContact(this.data.sheetId, false);
      const rc = info.receiveCount || 0;
      const gc = info.giftCount || 0;
      this.setData({
        sheetOpen: false,
        delModal: true,
        delContent: `${this.data.sheetName}\n将同时删除 ${rc} 条收礼、${gc} 条送礼记录`,
      });
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },

  onCancelDel() {
    this.setData({ delModal: false, delContent: '' });
  },

  async onConfirmDel() {
    try {
      await dataService.deleteContact(this.data.sheetId, true);
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.reload();
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this.setData({ delModal: false, delContent: '' });
    }
  },

  goAdd() {
    this.setData({ addSheetOpen: true });
  },

  onAddCancel() {
    this.setData({ addSheetOpen: false });
  },

  async onAddConfirm(e) {
    const { name, remark } = e.detail;
    try {
      const r = await dataService.createContact({ name, remark });
      this.setData({ addSheetOpen: false });
      await this.reload();
      if (r && r.duplicateWarning) {
        // core：重名只提醒不阻止，记录已创建
        wx.showModal({
          title: '已保存',
          content: '重名提醒：亲友录中已有同名亲友（不会合并）。',
          showCancel: false,
        });
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.showModal({ title: '提示', content: err.message, showCancel: false });
    }
  },
});
