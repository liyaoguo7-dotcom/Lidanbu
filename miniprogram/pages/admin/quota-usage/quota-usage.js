/**
 * 老板平台 · 用户额度使用情况（阶段5第12项）
 * 只看数量与剩余：礼薄数 / 送礼条数 / 亲友数 / 收礼额度池。
 * 输入脱敏用户号（如 oAb***9zQ）查询。
 */
const ds = require('../../../services/data-service.js');

const KIND_NAMES = {
  receiveEvents: '礼薄数',
  giftRecords: '送礼条数',
  contacts: '亲友数',
  receivePool: '收礼额度池',
};

Page({
  data: { masked: '', result: null, loading: false },
  onInput(e) { this.setData({ masked: e.detail.value.trim() }); },
  async onQuery() {
    const masked = this.data.masked;
    if (!masked) {
      wx.showToast({ title: '请输入脱敏用户号', icon: 'none' });
      return;
    }
    this.setData({ loading: true, result: null });
    try {
      const r = await ds.adminQuotaUsage(masked);
      this.setData({
        result: {
          ...r,
          usage: r.usage.map((u) => ({ ...u, kindName: KIND_NAMES[u.kind] || u.kind })),
        },
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
