/**
 * 礼单簿 · 收礼详情（阶段2 2B，仿 gift-detail）
 * 字段：姓名/类型/日期/金额/备注；底部删除/修改；"查看往来记录＞＞＞"进该亲友竖线树；
 * 删除走统一弹窗。金额两位小数。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    record: null,
    contactName: '',
    eventName: '',
    isBaishi: false,
    type: '',
    date: '',
    amountText: '',
    remark: '',
    showDelModal: false,
    delContent: '',
    canEdit: true, // 2026-10-31：成员视角按授权 edit/del 开关显隐修改／删除
    canDel: true,
    canWanglai: true, // 成员视角不进自己的往来竖线树（会串人），故隐藏
  },

  async onLoad(options) {
    await dataService.init();
    this.recordId = options.id;
    this.ownerId = options.ownerId || ''; // 成员视角：账本主人 id，缺省=自己
    await this.reload();
  },

  async onShow() {
    if (this.recordId) await this.reload();
  },

  async reload() {
    // 一次取齐（记录+联系人+所属礼薄）：原来三趟串行
    // 成员视角必须带账本主人，否则读到自己的记录；修改／删除按钮按授权开关显隐
    const owner = this.ownerId || '';
    const isMember = owner && owner !== dataService.getMyUserId();
    const d = await dataService.getRecordDetail(this.recordId, owner || undefined);
    let canEdit = true; let canDel = true;
    if (isMember) {
      const grant = await dataService.getGrantFor(owner).catch(() => null);
      canEdit = !!(grant && grant.switches && grant.switches.edit);
      canDel = !!(grant && grant.switches && grant.switches.del);
    }
    const r = d && d.record;
    if (!r) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const c = d.contact;
    const contactName = c ? c.name : '—';
    this._contactName = c ? c.name : '';
    // 顶部徽章右侧显示所属礼薄（事件）名；白事礼薄时徽章转灰（任务Z 第 12 项）
    const ev = d.event;
    const amountAbs = formatAmount(r.amount || 0);
    this.setData({
      record: r,
      contactName,
      eventName: ev ? (ev.name || '') : '',
      isBaishi: !!(ev && ev.tagId === 'baishi'),
      contactId: r.contactId,
      type: r.type || '',
      date: r.date || '',
      amountText: amountAbs, // 收礼金额，展示时带正号
      remark: r.remark || '无',
      delContent: `${contactName} · ${r.type || ''} · ${amountAbs}`,
      canEdit, canDel, canWanglai: !isMember,
    });
  },

  goWanglai() {
    const nameQ = this._contactName ? `&name=${encodeURIComponent(this._contactName)}` : '';
    wx.navigateTo({ url: `/pages/timeline/timeline?contactId=${this.data.contactId}${nameQ}` });
  },

  goEdit() {
    const owner = this.ownerId ? `&ownerId=${this.ownerId}` : '';
    wx.navigateTo({ url: `/pages/receive-record-edit/receive-record-edit?id=${this.recordId}${owner}` });
  },

  onDelete() {
    this.setData({ showDelModal: true });
  },

  onCancelDel() {
    this.setData({ showDelModal: false });
  },

  async onConfirmDel() {
    if (this._deleting) return; // 在途锁（任务AE补修：弹窗在 await 期间还开着，连点会重复删）
    this._deleting = true;
    try {
      await dataService.deleteRecord(this.recordId, this.ownerId || undefined);
      wx.showToast({ title: '已删除', icon: 'success' });
      wx.navigateBack(); // 成功提示是全局浮层，返回后仍可见：不再固定多等 600ms（2026-10-24 提速，用户反馈新建礼薄等保存后延迟）
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this._deleting = false;
      this.setData({ showDelModal: false });
    }
  },
});
