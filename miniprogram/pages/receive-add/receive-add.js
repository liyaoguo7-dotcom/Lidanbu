/**
 * 礼单簿 · 添加礼薄（阶段2 2B）
 * 标题"添加礼薄"；10 标签两排单选默认结婚；礼薄名称/日期/备注；底部保存。
 * 带 eventId 参数时为"修改礼薄"模式（预填，原内容可改）。
 */
const dataService = require('../../services/data-service.js');
const { saveForm, restoreForm, clearForm, wxStorage, RECEIVE_ADD_KEY } = require('../../services/form-state.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    tagId: '',
    name: '',
    date: '',
    remark: '',
    isEdit: false,
    title: '添加礼薄',
  },

  async onLoad(options) {
    await dataService.init();
    this.eventId = options.eventId || '';
    if (this.eventId) {
      // 修改模式：预填原内容
      const e = await dataService.getEvent(this.eventId);
      if (!e) {
        wx.showToast({ title: '礼薄不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      this.setData({
        isEdit: true,
        title: '修改礼薄',
        tagId: e.tagId || dataService.getDefaultTagId(),
        name: e.name || '',
        date: e.date || today(),
        remark: e.remark || '',
      });
      wx.setNavigationBarTitle({ title: '修改礼薄' });
      return;
    }
    const saved = restoreForm(wxStorage(), RECEIVE_ADD_KEY);
    if (saved && saved.name !== undefined) {
      this.setData(saved);
    } else {
      this.setData({ tagId: dataService.getDefaultTagId(), date: today() });
    }
  },

  onTagChange(e) {
    this.setData({ tagId: e.detail.id });
    this.persist();
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
    this.persist();
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
    this.persist();
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
    this.persist();
  },

  persist() {
    if (this.data.isEdit) return;
    saveForm(wxStorage(), RECEIVE_ADD_KEY, {
      tagId: this.data.tagId,
      name: this.data.name,
      date: this.data.date,
      remark: this.data.remark,
    });
  },

  async onSave() {
    const { tagId, name, date, remark, isEdit } = this.data;
    const trimmed = (name || '').trim();
    if (!trimmed) {
      wx.showToast({ title: '请填写礼薄名称', icon: 'none' });
      return;
    }
    try {
      if (isEdit) {
        await dataService.updateEvent(this.eventId, {
          name: trimmed, tagId, date, remark: (remark || '').trim(),
        });
      } else {
        await dataService.createEvent({
          name: trimmed, tagId, date, remark: (remark || '').trim(),
        });
        clearForm(wxStorage(), RECEIVE_ADD_KEY);
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({
        title: '提示',
        content: e.message,
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },
});
