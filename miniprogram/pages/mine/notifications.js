/**
 * 礼单簿 · 通知中心（任务L）
 * 站内通知列表：未读带红点，点开即标已读；「全部已读」一键清红点。
 * 数据走 data-service → core/notify（订阅消息通道为骨架，待云联调）。
 */
const dataService = require('../../../services/data-service.js');

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Page({
  data: { loading: true, items: [], unread: 0 },

  async onShow() {
    await dataService.init();
    await this.refresh();
  },

  async refresh() {
    try {
      const list = await dataService.listNotifications();
      const items = list.map((n) => ({ ...n, timeText: fmtTime(n.createdAt) }));
      this.setData({
        loading: false,
        items,
        unread: items.filter((n) => !n.read).length,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '消息加载失败，请稍后再试', icon: 'none' });
    }
  },

  /** 点开一条：标已读（只标自己的，服务端按登录身份校验） */
  async onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find((n) => n._id === id);
    if (!item || item.read) return;
    try {
      await dataService.markNotificationRead(id);
      const items = this.data.items.map((n) => (n._id === id ? { ...n, read: true } : n));
      this.setData({ items, unread: items.filter((n) => !n.read).length });
    } catch (err) { /* 标已读失败不打扰阅读 */ }
  },

  async onMarkAll() {
    try {
      await dataService.markAllNotificationsRead();
      await this.refresh();
    } catch (e) {
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },
});
