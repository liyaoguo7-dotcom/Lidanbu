/**
 * 老板平台 · 异常用户限制（第11项）
 * 按脱敏编号给用户打/摘限制标记：被限制的账号在所有记账写入口被拦
 * （只拦写、不拦看），操作写审计。编号先在「账号查询」页确认。
 */
const ds = require('../../services/data-service.js');

Page({
  data: { maskedId: '', reason: '', busy: false },
  onLoad() { wx.setNavigationBarTitle({ title: '异常用户限制' }); },
  onId(e) { this.setData({ maskedId: e.detail.value }); },
  onReason(e) { this.setData({ reason: e.detail.value }); },
  async submit(restricted) {
    const maskedId = this.data.maskedId.trim();
    if (!maskedId) { wx.showToast({ title: '先填脱敏编号', icon: 'none' }); return; }
    if (restricted && !this.data.reason.trim()) { wx.showToast({ title: '限制时必须写原因', icon: 'none' }); return; }
    const doIt = async () => {
      this.setData({ busy: true });
      try {
        await ds.adminSetUserRestricted(maskedId, { restricted, reason: this.data.reason.trim() });
        wx.showToast({ title: restricted ? '已限制该账号记账' : '已解除限制', icon: 'none' });
      } catch (e) {
        wx.showToast({ title: ds.friendly(e), icon: 'none' });
      }
      this.setData({ busy: false });
    };
    wx.showModal({
      title: restricted ? '确认限制' : '确认解除',
      content: restricted
        ? `限制后，账号 ${maskedId} 将不能新增、修改、删除任何记录（查看不受影响），确定吗？`
        : `确定解除账号 ${maskedId} 的限制吗？`,
      success: (r) => { if (r.confirm) doIt(); },
    });
  },
  onRestrict() { this.submit(true); },
  onUnrestrict() { this.submit(false); },
});
