/**
 * 礼单簿 · 新建/编辑请柬（阶段4）
 * 表单：类型、标题、日期、时间、地点（地图选点占位）、主人名、祝福语、4 种风格四宫格。
 */
const dataService = require('../../../services/data-service.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    id: '',
    types: [],
    styles: [],
    form: {
      type: 'wedding', title: '', eventDate: '', eventTime: '',
      address: '', hostName: '', blessing: '', styleId: 'guochao',
    },
    saving: false,
  },

  async onLoad(options) {
    await dataService.init();
    this.setData({
      types: dataService.getInvitationTypes(),
      styles: dataService.getInvitationStyles(),
    });
    if (options.id) {
      this.setData({ id: options.id });
      wx.setNavigationBarTitle({ title: '编辑请柬' });
      try {
        // 只允许编辑自己的请柬：从我的列表里取（core 改/删时还会再校验 owner）
        const mine = await dataService.listInvitations();
        const inv = mine.find((x) => x._id === options.id);
        if (!inv) {
          wx.showToast({ title: '请柬不存在或不是你的请柬', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 800);
          return;
        }
        this.setData({
          form: {
            type: inv.type, title: inv.title, eventDate: inv.eventDate,
            eventTime: inv.eventTime || '', address: inv.address || '',
            hostName: inv.hostName, blessing: inv.blessing || '', styleId: inv.styleId,
          },
        });
      } catch (e) {
        wx.showToast({ title: e.message, icon: 'none' });
      }
    } else {
      this.setData({ 'form.eventDate': today() });
    }
  },

  onTypeTap(e) { this.setData({ 'form.type': e.currentTarget.dataset.id }); },
  onStyleTap(e) { this.setData({ 'form.styleId': e.currentTarget.dataset.id }); },
  onTitleInput(e) { this.setData({ 'form.title': e.detail.value }); },
  onDateChange(e) { this.setData({ 'form.eventDate': e.detail.value }); },
  onTimeChange(e) { this.setData({ 'form.eventTime': e.detail.value }); },
  onAddressInput(e) { this.setData({ 'form.address': e.detail.value }); },
  onHostInput(e) { this.setData({ 'form.hostName': e.detail.value }); },
  onBlessingInput(e) { this.setData({ 'form.blessing': e.detail.value }); },

  onMapTap() {
    // 地图选点占位：云环境与定位权限到位后接 wx.chooseLocation，只回填 mapLoc，表单不动
    wx.showToast({ title: '地图选点即将上线，可先把地址填在上面', icon: 'none' });
  },

  async onSave() {
    if (this.data.saving) return;
    const f = this.data.form;
    this.setData({ saving: true });
    try {
      if (this.data.id) {
        await dataService.updateInvitation(this.data.id, f);
        wx.showToast({ title: '已保存', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 500);
      } else {
        const created = await dataService.createInvitation(f);
        wx.showToast({ title: '请柬建好了', icon: 'none' });
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/invitation/preview/preview?id=${created._id}` });
        }, 500);
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
