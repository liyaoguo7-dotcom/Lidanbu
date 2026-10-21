/**
 * 老板平台 · 拍照导入用量监控（第4项）
 * 按日/周聚合导入次数、成功率、失败大类分布。只有数字，
 * 无图片、无识别内容、无账本字段。
 */
const ds = require('../../services/data-service.js');

const REASON_NAMES = { quota: '额度不足拦截', validation: '内容校验未过', 'write-error': '写入异常' };

Page({
  data: { granularity: 'day', stats: null, loading: true },
  onLoad() { wx.setNavigationBarTitle({ title: '拍照导入用量' }); },
  onShow() { this.load(); },
  onGran(e) { this.setData({ granularity: e.currentTarget.dataset.g }); this.load(); },
  async load() {
    this.setData({ loading: true });
    try {
      const s = await ds.adminImportUsage({ granularity: this.data.granularity });
      const stats = {
        ...s,
        failReasons: s.failReasons.map((r) => ({ ...r, name: REASON_NAMES[r.reason] || r.reason })),
      };
      this.setData({ stats, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
