/**
 * 礼单簿 · 往来竖线树（阶段2 2B）
 * 调 data-service.getTimeline（经 core.stats.memberTimeline，成员视角自动过滤）。
 * 从早到晚；每条 +/-号金额（深色文字，不用红绿蓝，方向靠 +/- 表达）；
 * 每条右侧钢笔图标 → 修改/删除/取消（action sheet）；删除走 confirm-modal。
 * ?ownerId=xxx 时为成员视角：顶部淡字"仅统计已授权给你的记录"。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    contactName: '',
    isMember: false,
    diffText: '',
    items: [],
    showDelModal: false,
    delContent: '',
  },

  async onLoad(options) {
    await dataService.init();
    this.contactId = options.contactId || '';
    this.ownerId = options.ownerId || '';
    await this.reload();
  },

  async onShow() {
    if (this.contactId) await this.reload();
  },

  async reload() {
    try {
      const tl = await dataService.getTimeline({
        contactId: this.contactId,
        ownerId: this.ownerId || undefined,
      });
      const items = tl.items.map((it) => {
        const signed = it.type === 'receive' ? it.amountFen : -it.amountFen;
        return {
          ...it,
          date: it.date || '',
          amountText: `${signed < 0 ? '-' : '+'}${formatAmount(Math.abs(signed))}`,
          desc: it.type === 'receive'
            ? `${it.tagName || ''}｜${it.eventName || ''}`
            : (it.tagName || ''),
        };
      });
      const recv = formatAmount(tl.receiveTotalFen);
      const gift = formatAmount(tl.giftTotalFen);
      const diff = tl.diffFen;
      this.setData({
        contactName: tl.contactName || '',
        isMember: !!tl.isMember,
        diffText: `差额：收到 ${recv} − 送出 ${gift} = ${diff < 0 ? '-' : '+'}${formatAmount(Math.abs(diff))}`,
        items,
      });
      wx.setNavigationBarTitle({ title: `与${tl.contactName || ''}的往来` });
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    }
  },

  /** 钢笔图标：修改/删除/取消 */
  onPenTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const it = this.data.items[idx];
    if (!it) return;
    this.pendingItem = it;
    wx.showActionSheet({
      itemList: ['修改', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.goEdit(it);
        else if (res.tapIndex === 1) this.askDelete(it);
      },
    });
  },

  goEdit(it) {
    if (it.kind === 'receiveRecord') {
      wx.navigateTo({ url: `/pages/receive-record-edit/receive-record-edit?id=${it.recordId}` });
    } else {
      wx.navigateTo({ url: `/pages/gift-edit/gift-edit?id=${it.recordId}` });
    }
  },

  askDelete(it) {
    const label = it.type === 'receive' ? '收礼记录' : '送礼记录';
    this.pendingDelete = it;
    this.setData({
      showDelModal: true,
      delTitle: `删除${label}`,
      delContent: `${this.data.contactName} · ${it.desc} · ${it.amountText}`,
    });
  },

  onCancelDel() {
    this.setData({ showDelModal: false });
    this.pendingDelete = null;
  },

  async onConfirmDel() {
    const it = this.pendingDelete;
    if (!it) {
      this.setData({ showDelModal: false });
      return;
    }
    try {
      if (it.kind === 'receiveRecord') {
        await dataService.deleteRecord(it.recordId);
      } else {
        await dataService.deleteGift(it.recordId);
      }
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.reload();
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
    } finally {
      this.setData({ showDelModal: false });
      this.pendingDelete = null;
    }
  },
});
