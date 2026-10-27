/**
 * 礼单簿 · 拍照导入（收礼）：先新建或选择礼薄，再拍照（阶段4）
 * 未选礼薄不能进拍照（core.importer.validateTarget 兜底）。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    hornOff: false, hornRun: false, hornDur: 0, // 小喇叭：关闭（本次打开期间）/长文字慢速左滚（任务AB）
    tipText: '收礼要先选好礼薄，选完可以一次拍多张照片，识别结果会记进这本礼薄',
    events: [],
    newName: '',
    newTagId: '',
  },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText, { fontPx: 14, avail: 284 }); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('import-event'); this.setData({ hornOff: true }); },

  async onLoad() {
    this.setData({ hornOff: hornState.isDismissed('import-event') }); this._syncHorn();
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

  /** 选已有礼薄 → 攒照片页（BJ批） */
  pickEvent(e) {
    const id = e.currentTarget.dataset.id;
    const ev = this.data.events.find((x) => x._id === id);
    if (!ev) return;
    this._goPhotos(ev._id, ev.name);
  },

  _goPhotos(eventId, eventName) {
    wx.navigateTo({ url: `/pages/import/import-photos?kind=receive&eventId=${eventId}&eventName=${encodeURIComponent(eventName || '')}` });
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
      this._goPhotos(ev._id, ev.name);
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    }
  },

});
