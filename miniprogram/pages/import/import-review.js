/**
 * 礼单簿 · 拍照导入：识别结果核对（对照原图编辑 + 整批确认导入）
 * 顶部固定原图缩略图（点开大图）对照；下方条目逐条可编辑：
 * 姓名（可从亲友录选/新建）、金额、类型（收礼）/场合（送礼）、日期、备注；
 * 条目可删可加。底部"全部确认导入"整批写入——写入前 core 逐条+整批
 * 校验，任一条不合格整批不写并定位高亮到该条；成功后显示结果（成功条数）。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');
const { formatAmount, parseAmountToFen } = require('../../core/format.js');
const { takeImport, saveImport, takeNextImport, importQueueCount } = require('../../services/import-state.js');

function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    hornOff: false, hornRun: false, hornDur: 0, // 小喇叭：关闭（本次打开期间）/长文字慢速左滚（任务AB）
    tipText: '', // onLoad 按 kind 生成（类型/场合）后 _syncHorn
    kind: 'gift',
    kindLabel: '送礼',
    eventId: '',
    eventName: '',
    jobId: '', // 导入任务号（识别时生成；写入时传回 core，额度拦截靠它自动返还积分）
    photoPath: '', // 本地原图路径（本页缩略图/大图对照用，云端照片是另一份，见 photoFileIds）
    photoFileIds: [], // AR批：云模式识别前上传云存储的 fileID 数组；确认写入成功后删云端原件
    items: [], // { name, amountText, note, contactId, unknown, type, tagId, tagName, date }
    tags: [],        // 送礼场合选项
    recordTypes: [], // 收礼类型选项
    errorIndex: -1,  // 校验失败定位到的条目下标
    addSheetOpen: false,
    editingIndex: -1,
    qcOpen: false,   // BN批：快速创建弹窗（姓名/备注弹窗内直接编辑创建）
    qcIndex: -1,
    qcName: '',
    qcRemark: '',
    pickerOpen: false,
    pickerIndex: -1,
    pickerKeyword: '',
    pickerList: [],
    writing: false,
    done: false,
    doneCount: 0,
    queueCount: 0, // BJ批：多张识别时还没核对的张数
  },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText, { fontPx: 14, avail: 284 }); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('import-review'); this.setData({ hornOff: true }); },

  async onLoad() {
    this.setData({ hornOff: hornState.isDismissed('import-review') });
    await dataService.init();
    const pending = takeImport();
    if (!pending || !Array.isArray(pending.items)) {
      wx.showToast({ title: '没有识别结果，请重新拍照', icon: 'none' });
      wx.navigateBack();
      return;
    }
    const tags = dataService.getTags();
    const other = tags.find((t) => t.id === 'qita') || tags[tags.length - 1] || { id: 'qita', name: '其他' };
    const items = pending.items.map((it) => ({
      name: it.name || '',
      amountText: it.amountFen ? formatAmount(it.amountFen) : '',
      note: it.note || '',
      contactId: '',
      unknown: false,
      type: '现金',
      tagId: other.id,
      tagName: other.name,
      date: today(),
    }));
    // AS批：收礼核对页已去掉日期行，喇叭文案对收礼不再提日期（送礼仍可改日期）
    const hornText = '对着原图逐条核对：姓名可以从亲友录选，金额、' + (pending.kind === 'receive' ? '类型、备注' : '场合、日期、备注') + '都能改；错的删掉，不够再补录。全部改好点底部"全部确认导入"，一次写进账本。';
    this.setData({ tipText: hornText });
    this._syncHorn();
    this.setData({
      kind: pending.kind === 'receive' ? 'receive' : 'gift',
      kindLabel: pending.kind === 'receive' ? '收礼' : '送礼',
      eventId: pending.eventId || '',
      eventName: pending.eventName || '',
      jobId: pending.jobId || '',
      photoPath: pending.photoPath || '',
      photoFileIds: pending.photoFileIds || [],
      items,
      tags,
      recordTypes: dataService.getRecordTypes(),
    });
    // 逐条匹配亲友录（精确匹配姓名）
    for (let i = 0; i < items.length; i++) {
      await this._resolveContact(i);
    }
  },

  /** 按姓名精确匹配亲友录；无匹配则标记 unknown，引导选/建亲友 */
  async _resolveContact(i) {
    const items = this.data.items;
    if (!items[i]) return;
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

  noop() {},

  _clearError(i) {
    if (this.data.errorIndex === i) this.setData({ errorIndex: -1 });
  },

  previewPhoto() {
    if (!this.data.photoPath) return;
    wx.previewImage({ urls: [this.data.photoPath] });
  },

  onNameInput(e) {
    const i = e.currentTarget.dataset.i;
    this._clearError(i);
    this.setData({ [`items[${i}].name`]: e.detail.value, [`items[${i}].contactId`]: '' });
  },
  async onNameBlur(e) {
    const i = e.currentTarget.dataset.i;
    await this._resolveContact(i);
  },

  onAmountInput(e) {
    const i = e.currentTarget.dataset.i;
    this._clearError(i);
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

  /** 收礼类型 */
  onTypeChange(e) {
    const i = e.currentTarget.dataset.i;
    this.setData({ [`items[${i}].type`]: this.data.recordTypes[Number(e.detail.value)] });
  },
  /** 送礼场合 */
  onTagChange(e) {
    const i = e.currentTarget.dataset.i;
    const tag = this.data.tags[Number(e.detail.value)];
    if (!tag) return;
    this.setData({ [`items[${i}].tagId`]: tag.id, [`items[${i}].tagName`]: tag.name });
  },
  /** 日期 */
  onDateChange(e) {
    const i = e.currentTarget.dataset.i;
    this._clearError(i);
    this.setData({ [`items[${i}].date`]: e.detail.value });
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
        this.setData({ items, errorIndex: -1 });
      },
    });
  },

  onAddItem() {
    const tags = this.data.tags;
    const other = tags.find((t) => t.id === 'qita') || tags[tags.length - 1] || { id: 'qita', name: '其他' };
    const items = this.data.items.slice();
    items.push({
      name: '', amountText: '', note: '', contactId: '', unknown: false,
      type: '现金', tagId: other.id, tagName: other.name, date: today(),
    });
    this.setData({ items });
  },

  /* ---------- 从亲友录选亲友 ---------- */

  async openPicker(e) {
    const i = e.currentTarget.dataset.i;
    let list = [];
    try { list = await dataService.listContacts(); } catch (err) { /* 演示期忽略 */ }
    this.setData({ pickerOpen: true, pickerIndex: i, pickerKeyword: '', pickerList: list || [] });
  },
  closePicker() {
    this.setData({ pickerOpen: false, pickerIndex: -1 });
  },
  async onPickerSearch(e) {
    const kw = e.detail.value || '';
    this.setData({ pickerKeyword: kw });
    try {
      const list = await dataService.searchContacts(kw.trim());
      this.setData({ pickerList: list || [] });
    } catch (err) { /* 演示期忽略 */ }
  },
  pickContact(e) {
    const { id, name } = e.currentTarget.dataset;
    const i = this.data.pickerIndex;
    if (i < 0) return;
    this._clearError(i);
    this.setData({
      [`items[${i}].name`]: name,
      [`items[${i}].contactId`]: id,
      [`items[${i}].unknown`]: false,
      pickerOpen: false,
      pickerIndex: -1,
    });
  },
  /** 在选择器里新建亲友：转到既有建亲友半屏 */
  pickerBuildNew() {
    const i = this.data.pickerIndex;
    this.setData({ pickerOpen: false, pickerIndex: -1 });
    if (i >= 0) this.onBuildContact({ currentTarget: { dataset: { i } } });
  },

  /* ---------- 建亲友（生僻姓名） ---------- */

  onBuildContact(e) {
    this.setData({ addSheetOpen: true, editingIndex: e.currentTarget.dataset.i });
  },
  onAddCancel() {
    this.setData({ addSheetOpen: false, editingIndex: -1 });
  },

  /* BN批快速创建（用户 2026-10-27 晚定版，覆盖 BJ 两段式）：点「快速
   * 创建」直接弹编辑弹窗——姓名框预填识别名（可改）、备注框预填本条
   * 备注（可空），框下一行淡字提醒原话，左「取消」右「确认」；点确认
   * 即以弹窗内的姓名＋备注建亲友并绑定本条，备注同步亲友录，姓名改了
   * 本条随改。不再有"退回去改完再点一次"的两段式。重复姓名按既有
   * createContact 口径选中已有亲友。 */
  onQuickCreate(e) {
    const i = Number(e.currentTarget.dataset.i);
    const it = this.data.items[i];
    if (!it) return;
    this.setData({
      qcOpen: true,
      qcIndex: i,
      qcName: (it.name || '').trim(),
      qcRemark: (it.note || '').trim(),
    });
  },
  onQcNameInput(e) { this.setData({ qcName: e.detail.value }); },
  onQcRemarkInput(e) { this.setData({ qcRemark: e.detail.value }); },
  onQcCancel() { this.setData({ qcOpen: false, qcIndex: -1 }); },
  async onQcConfirm() {
    if (this._quickCreating) return;
    const i = this.data.qcIndex;
    const name = (this.data.qcName || '').trim();
    const remark = (this.data.qcRemark || '').trim();
    if (!name) {
      wx.showToast({ title: '先把姓名填好', icon: 'none' });
      return;
    }
    this._quickCreating = true;
    try {
      const r = await dataService.createContact({ name, remark });
      const newId = r && r._id;
      this.setData({
        qcOpen: false,
        qcIndex: -1,
        [`items[${i}].name`]: name,
        [`items[${i}].note`]: remark,
        [`items[${i}].contactId`]: newId || '',
        [`items[${i}].unknown`]: newId ? false : true,
      });
      wx.showToast({ title: r && r.duplicateWarning ? '该姓名已在亲友录，已选中' : '已创建亲友', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '创建失败', icon: 'none' });
    } finally { this._quickCreating = false; }
  },
  async onAddConfirm(e) {
    if (this._saving) return; // 在途锁（任务AE补修）
    this._saving = true;
    const { name, remark } = e.detail;
    const i = this.data.editingIndex;
    try {
      const r = await dataService.createContact({ name, remark });
      const newId = r && r._id;
      const patch = { addSheetOpen: false, editingIndex: -1 };
      if (i >= 0) {
        patch[`items[${i}].name`] = name;
        patch[`items[${i}].contactId`] = newId || '';
        patch[`items[${i}].unknown`] = newId ? false : true;
      }
      this.setData(patch);
      wx.showToast({ title: r && r.duplicateWarning ? '该姓名已存在，已选中' : '已添加并选中', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' });
    } finally { this._saving = false; }
  },

  /* ---------- 全部确认导入（整批原子） ---------- */

  _locateError(i, message) {
    this.setData({ errorIndex: i });
    wx.pageScrollTo({ selector: `#item-${i}`, duration: 300 });
    wx.showModal({ title: '先改一下这条', content: message, showCancel: false, confirmText: '知道了' });
  },

  async onConfirmWrite() {
    if (this.data.writing || this.data.done) return;
    const items = this.data.items;
    if (items.length === 0) {
      wx.showToast({ title: '没有可写入的记录', icon: 'none' });
      return;
    }
    // 写入前逐条快速校验（与 core 同口径，core 再兜底整批校验）
    const payload = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = (it.name || '').trim();
      if (!name) {
        this._locateError(i, `第${i + 1}条姓名还是空的，填上姓名或者从亲友录选一位。`);
        return;
      }
      if (!it.contactId) {
        this._locateError(i, `「${name}」还不在亲友录，点"选亲友"选一位，或者点"快速创建"。`);
        return;
      }
      const fen = parseAmountToFen(it.amountText);
      if (fen === null || fen <= 0) {
        this._locateError(i, `「${name}」的金额不对，检查一下再导入。`);
        return;
      }
      payload.push({
        name,
        contactId: it.contactId,
        amountFen: fen,
        note: (it.note || '').trim(),
        type: it.type || '现金',
        tagId: it.tagId || 'qita',
        date: it.date || today(),
      });
    }

    this.setData({ writing: true, errorIndex: -1 });
    wx.showLoading({ title: '导入中...' });
    try {
      const r = await dataService.importWrite({
        kind: this.data.kind,
        eventId: this.data.eventId,
        items: payload,
        jobId: this.data.jobId,
      });
      wx.hideLoading();
      this.setData({ writing: false, done: true, doneCount: r.written, queueCount: importQueueCount() });
      // AR批：任务确认完成 → 删掉云端那批照片原件（尽力而为、失败静默；
      // 本页对照看的是本地 photoPath，不受影响）
      dataService.cleanupImportPhotos(this.data.photoFileIds);
    } catch (e) {
      wx.hideLoading();
      this.setData({ writing: false });
      if (e.code === 'insufficient-points') {
        // 积分相关拦截：给出去购买页补充积分的入口（额度拦截时积分已由 core 自动返还）
        wx.showModal({
          title: '积分不够啦',
          content: e.message || '积分不够啦，先去补充一点积分再来导入吧。',
          confirmText: '去补充积分',
          cancelText: '算了',
          success: (r) => {
            if (r.confirm) wx.navigateTo({ url: '/pages/member/purchase/purchase' });
          },
        });
      } else if (Number.isInteger(e.itemIndex) && e.itemIndex >= 0 && e.itemIndex < items.length) {
        // 整批未写入：定位到出问题的那条（额度不足时定位第一条放不下的）
        this._locateError(e.itemIndex, e.message || '有一条没通过，改好再整批导入。');
      } else {
        wx.showModal({
          title: '提示',
          content: e.message || '导入失败',
          showCancel: false,
          confirmText: '知道了',
        });
      }
    }
  },

  /* ---------- 结果页动作 ---------- */

  /* BJ批：多张识别时，导入完一张接着核对下一张 */
  goNextJob() {
    const nxt = takeNextImport();
    if (!nxt) return;
    saveImport(nxt);
    wx.redirectTo({ url: '/pages/import/import-review' });
  },
  goViewRecords() {
    if (this.data.kind === 'receive' && this.data.eventId) {
      wx.redirectTo({ url: `/pages/receive-detail/receive-detail?id=${this.data.eventId}` });
    } else {
      wx.navigateTo({ url: '/pages/gifts/gifts' });
    }
  },
  goAgain() {
    wx.redirectTo({ url: '/pages/import/import-home' });
  },
});
