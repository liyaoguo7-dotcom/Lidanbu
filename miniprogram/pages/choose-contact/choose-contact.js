/**
 * 礼单簿 · 选择亲友（阶段2 2A）
 * 搜索框 + 右侧"取消"；小喇叭提示；列表同亲友录样式；
 * 底部中间＋（去新增亲友，返回后继续选）；选中后回传。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');
const { wxStorage, savePick } = require('../../services/form-state.js');

Page({
  data: {
    hornOff: false, hornRun: false, hornDur: 0, // 小喇叭：关闭（本次打开期间）/长文字慢速左滚（任务AB）
    contacts: [],
    keyword: '',
    tipText: '若亲友姓名不在列表中，请点击下方红色按钮添加',
    addSheetOpen: false,
  },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('choose-contact'); this.setData({ hornOff: true }); },

  async onLoad(options) {
    this.setData({ hornOff: hornState.isDismissed('choose-contact') }); this._syncHorn();
    await dataService.init();
    this.from = (options && options.from) || '';
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
    this.setData({ addSheetOpen: true });
  },

  onAddCancel() {
    this.setData({ addSheetOpen: false });
  },

  async onAddConfirm(e) {
    const { name, remark } = e.detail;
    try {
      const r = await dataService.createContact({ name, remark });
      const newId = r && r._id;
      this.setData({ addSheetOpen: false });
      if (this.from) {
        // 从录入流程（添加/修改送礼）来：自动选中新亲友并返回，
        // 表单页 onShow 用 form-state 领取 pick，已填内容保留
        if (newId) savePick(wxStorage(), { contactId: newId, contactName: name });
        if (r && r.duplicateWarning) {
          wx.showModal({
            title: '已保存',
            content: '重名提醒：亲友录中已有同名亲友（不会合并）。',
            showCancel: false,
            success: () => wx.navigateBack(),
          });
          return;
        }
        wx.navigateBack();
        return;
      }
      // 直接进入本页：留在列表，刷新即可继续选
      await this.reload();
      if (r && r.duplicateWarning) {
        wx.showModal({
          title: '已保存',
          content: '重名提醒：亲友录中已有同名亲友（不会合并）。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: '已保存', icon: 'success' });
      }
    } catch (err) {
      wx.showModal({ title: '提示', content: err.message, showCancel: false });
    }
  },
});
