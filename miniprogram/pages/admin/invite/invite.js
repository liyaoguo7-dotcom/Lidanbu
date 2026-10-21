/**
 * 老板平台 · 邀请奖励设置与数据（阶段5第14项）
 * 数据只看数量：邀请人数、成功邀请次数、已发放额度。
 * 设置展示静态配置默认值；生效值以服务端为准（管理员经
 * core.admin.updateInviteSettings 修改并覆盖，记入操作记录）。
 */
const ds = require('../../../services/data-service.js');
const AppConfig = require('../../../config/app-config.js');

Page({
  data: { stats: null, cfg: null, loading: true },
  async onShow() {
    this.setData({ loading: true, cfg: AppConfig.inviteReward || null });
    try {
      const stats = await ds.adminInviteStats();
      this.setData({ stats, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: ds.friendly(e), icon: 'none' });
    }
  },
});
