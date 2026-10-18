/**
 * 礼单簿 · 拍照导入（收礼）：先新建或选择礼薄，再拍照（阶段4）
 * 未选礼薄不能进拍照（core.importer.validateTarget 兜底）。
 */
const dataService = require('../../services/data-service.js');
const { saveImport } = require('../../services/import-state.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    events: [],
    newName: '',
    newTagId: '',
  },

  async onLoad() {
    await dataService.init();
    this.setData({ newTagId: dataService.getDefaultTagId(), newName: '' });
    await this.refresh();
  },

  async refresh() {
    try {
      const events = await dataService.listEvents();
      this.setData({ events });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onTagChange(e) {
    this.setData({ newTagId: e.detail.id });
  },

  onNameInput(e) {
    this.setData({ newName: e.detail.value });
  },

  /** 选已有礼薄 → 拍照 */
  pickEvent(e) {
    const id = e.currentTarget.dataset.id;
    const ev = this.data.events.find((x) => x._id === id);
    if (!ev) return;
    this._takePhoto(ev._id, ev.name);
  },

  /** 新建礼薄 → 拍照 */
  async createAndPhoto() {
    const name = (this.data.newName || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写礼薄名称', icon: 'none' });
      return;
    }
    try {
      const ev = await dataService.createEvent({
        name,
        tagId: this.data.newTagId,
        date: today(),
      });
      this._takePhoto(ev._id, ev.name);
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    }
  },

  _takePhoto(eventId, eventName) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: async (res) => {
        const photoPath = res.tempFilePaths[0];
        wx.showLoading({ title: '识别中...' });
        try {
          const items = await dataService.recognizePhoto(photoPath, 'receive');
          wx.hideLoading();
          saveImport({ kind: 'receive', eventId, eventName, photoPath, items });
          wx.navigateTo({ url: '/pages/import/import-review' });
        } catch (e) {
          wx.hideLoading();
          wx.showModal({
            title: '识别失败',
            content: '识别失败了，这次不收任何费用，换张清楚点的照片试试～',
            showCancel: false,
            confirmText: '知道了',
          });
        }
      },
    });
  },
});
