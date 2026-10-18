/**
 * 礼单簿 · 往来竖线树（v3.1 14.2 双栏）
 * 调 data-service.getTimeline（经 core.stats.memberTimeline，成员视角自动过滤）。
 * 左送出/右收到双栏，从早到晚；每条三行：日期（灰）→事由→金额（黑粗体，¥前缀，送出-/收到+）；
 * 底部汇总淡黄底三行（送出/收到/差额，差额红字无符号）；每条钢笔线条图标 → 修改/删除/取消（action sheet）；删除走 confirm-modal。
 * ?ownerId=xxx 时为成员视角：顶部淡字"仅统计已授权给你的记录"。
 */
const dataService = require('../../services/data-service.js');
const { formatAmount } = require('../../core/format.js');

Page({
  data: {
    contactName: '',
    isMember: false,
    sumSend: '',
    sumRecv: '',
    sumDiff: '',    items: [],
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
          // v3.1 14.2：金额黑粗体，¥前缀；送出负号、收到正号
          amountText: `¥${signed < 0 ? '-' : '+'}${formatAmount(Math.abs(signed))}`,
          // v3.1 14.2：送出事由=场合名，收到事由=礼薄名称
          desc: it.type === 'receive' ? (it.eventName || '') : (it.tagName || ''),
        };
      });
      const recv = formatAmount(tl.receiveTotalFen);
      const gift = formatAmount(tl.giftTotalFen);
      const diff = tl.diffFen;
      this.setData({
        contactName: tl.contactName || '',
        isMember: !!tl.isMember,
        // v3.1 14.2：底部三行居中，差额=收到−送出，不加符号不用颜色
        sumSend: `¥${gift}`,
        sumRecv: `¥${recv}`,
        sumDiff: `¥${formatAmount(Math.abs(diff))}`,
        items,
      });
      wx.setNavigationBarTitle({ title: `往来记录 - ${tl.contactName || ''}` });
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
