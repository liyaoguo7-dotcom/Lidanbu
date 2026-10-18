/**
 * 礼单簿 · 拍照导入：识别结果核对（阶段4）
 * 识别结果呈可编辑文本（可改可删可补录），左侧原图对照；
 * 生僻姓名引导先建亲友；底部"确认写入"后才落库。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount, parseAmountToFen } = require('../../core/format.js');
const { takeImport } = require('../../services/import-state.js');

Page({
  data: {
    kind: 'gift',
    kindLabel: '送礼',
    eventId: '',
    eventName: '',
    photoPath: '',
    items: [], // { name, amountText, note, contactId, unknown }
    addSheetOpen: false,
    editingIndex: -1,
    writing: false,
  },

  async onLoad() {
    await dataService.init();
    const pending = takeImport();
    if (!pending || !Array.isArray(pending.items)) {
      wx.showToast({ title: '没有识别结果，请重新拍照', icon: 'none' });
      wx.navigateBack();
      return;
    }
    const items = pending.items.map((it) => ({
      name: it.name || '',
      amountText: it.amountFen ? formatAmount(it.amountFen) : '',
      note: it.note || '',
      contactId: '',
      unknown: false,
    }));
    this.setData({
      kind: pending.kind === 'receive' ? 'receive' : 'gift',
      kindLabel: pending.kind === 'receive' ? '收礼' : '送礼',
      eventId: pending.eventId || '',
      eventName: pending.eventName || '',
      photoPath: pending.photoPath || '',
      items,
    });
    // 逐条匹配亲友录（精确匹配姓名）
    for (let i = 0; i < items.length; i++) {
      await this._resolveContact(i);
    }
  },

  /** 按姓名精确匹配亲友录；无匹配则标记 unknown，引导建亲友 */
  async _resolveContact(i) {
    const items = this.data.items;
    const name = (items[i].name || '').trim();
    if (!name) {
      this.setData({ [`items[${i}].unknown`]: false, [`items[${i}].contactId`]: '' });
      return;
    }
    try {
      const list = await dataService.searchContacts(name);
      const hit = (list || []).find((c) => c.name === name);
      if (hit) {
        this.setData({ [`items[${i}].contactId`]: hit._id, [`items[${i}].unknown`]: false });
      } else {
        this.setData({ [`items[${i}].contactId`]: '', [`items[${i}].unknown`]: true });
      }
    } catch (e) {
      this.setData({ [`items[${i}].unknown`]: true });
    }
  },

  previewPhoto() {
    if (!this.data.photoPath) return;
    wx.previewImage({ urls: [this.data.photoPath] });
  },

  onNameInput(e) {
    const i = e.currentTarget.dataset.i;
    this.setData({ [`items[${i}].name`]: e.detail.value });
  },
  async onNameBlur(e) {
    const i = e.currentTarget.dataset.i;
    await this._resolveContact(i);
  },

  onAmountInput(e) {
    const i = e.currentTarget.dataset.i;
    let v = (e.detail.value || '').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    this.setData({ [`items[${i}].amountText`]: v });
  },
  onAmountBlur(e) {
    const i = e.currentTarget.dataset.i;
    const raw = (this.data.items[i].amountText || '').trim();
    if (!raw) return;
    const fen = parseAmountToFen(raw);
    if (fen === null) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    this.setData({ [`items[${i}].amountText`]: formatAmount(fen) });
  },

  onNoteInput(e) {
    const i = e.currentTarget.dataset.i;
    this.setData({ [`items[${i}].note`]: e.detail.value });
  },

  onDeleteItem(e) {
    const i = e.currentTarget.dataset.i;
    const name = this.data.items[i].name || `第${i + 1}条`;
    wx.showModal({
      title: '删除这条？',
      content: `删除「${name}」，删除后这条不会写入账本。`,
      confirmText: '删除',
      confirmColor: '#F0575A',
      success: (res) => {
        if (!res.confirm) return;
        const items = this.data.items.slice();
        items.splice(i, 1);
        this.setData({ items });
      },
    });
  },

  onAddItem() {
    const items = this.data.items.slice();
    items.push({ name: '', amountText: '', note: '', contactId: '', unknown: false });
    this.setData({ items });
  },

  /** 生僻姓名：先建亲友 */
  onBuildContact(e) {
    this.setData({ addSheetOpen: true, editingIndex: e.currentTarget.dataset.i });
  },
  onAddCancel() {
    this.setData({ addSheetOpen: false, editingIndex: -1 });
  },
  async onAddConfirm(e) {
    const { name, remark } = e.detail;
    const i = this.data.editingIndex;
    try {
      const r = await dataService.createContact({ name, remark });
      const newId = r && r._id;
      const patch = { addSheetOpen: false, editingIndex: -1 };
      patch[`items[${i}].name`] = name;
      patch[`items[${i}].contactId`] = newId || '';
      patch[`items[${i}].unknown`] = newId ? false : true;
      this.setData(patch);
      wx.showToast({ title: r && r.duplicateWarning ? '该姓名已存在，已选中' : '已添加并选中', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' });
    }
  },

  /** 确认写入：校验 → 逐条落库；额度满走卖惨文案 */
  async onConfirmWrite() {
    if (this.data.writing) return;
    const items = this.data.items;
    if (items.length === 0) {
      wx.showToast({ title: '没有可写入的记录', icon: 'none' });
      return;
    }
    // 校验：姓名/亲友/金额
    const payload = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = (it.name || '').trim();
      if (!name) {
        wx.showToast({ title: `第${i + 1}条姓名为空`, icon: 'none' });
        return;
      }
      if (!it.contactId) {
        wx.showModal({
          title: '先建亲友',
          content: `「${name}」还不在亲友录，请点"先建亲友"后再写入。`,
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      const fen = parseAmountToFen(it.amountText);
      if (fen === null) {
        wx.showToast({ title: `「${name}」金额不正确`, icon: 'none' });
        return;
      }
      payload.push({ name, contactId: it.contactId, amountFen: fen, note: (it.note || '').trim() });
    }

    this.setData({ writing: true });
    wx.showLoading({ title: '写入中...' });
    try {
      const r = await dataService.importWrite({
        kind: this.data.kind,
        eventId: this.data.eventId,
        items: payload,
      });
      wx.hideLoading();
      this.setData({ writing: false });
      wx.showModal({
        title: '写入成功',
        content: `已写入 ${r.written} 条${this.data.kindLabel}记录。`,
        showCancel: false,
        confirmText: '好的',
        success: () => wx.redirectTo({ url: '/pages/import/import-home' }),
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ writing: false });
      const head = e.written > 0 ? `已写入 ${e.written}/${e.total} 条，` : '';
      wx.showModal({
        title: '提示',
        content: head + (e.message || '写入失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },
});
