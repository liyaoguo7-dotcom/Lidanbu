/**
 * 礼单簿 · 应用入口
 * T0.1：Tab2 名称从配置读取并动态设置（不得写死）；云开发初始化占位（阶段1 接入）。
 * 2A：启动时初始化数据服务层（本地模式用微信本地存储演示）。
 */
const AppConfig = require('./config/app-config.js');
const dataService = require('./services/data-service.js');

App({
  globalData: {
    config: AppConfig,
    // 云开发环境 ID：唯一来源是配置中心 AppConfig.cloudEnvId
    // （换正式版时只改 app-config.js 那一处，见该文件头说明；这里不要再写一份）
    cloudEnvId: AppConfig.cloudEnvId,
  },

  /** 捕获分享进入时携带的邀请码（path 上的 inviteCode 参数），存起来待 init 后绑定 */
  captureInvite(options) {
    const q = (options && options.query) || {};
    const code = q.inviteCode || q.code;
    if (code) dataService.setPendingInviteCode(code);
  },

  async onLaunch(options) {
    this.captureInvite(options);
    // Tab2（往来）名称暂定，放配置：启动时从配置读取并动态设置 tabBar
    const wanglaiTab = AppConfig.tabs[1];
    if (wanglaiTab && typeof wx.setTabBarItem === 'function') {
      wx.setTabBarItem({
        index: 1,
        text: wanglaiTab.name,
      });
    }

    // 云开发初始化：配置中心 AppConfig.cloudEnvId 填了环境 ID 才启用；
    // 本地预览时为空字符串，自动跳过（不连云、不用管云开发）
    if (this.globalData.cloudEnvId && wx.cloud) {
      wx.cloud.init({ env: this.globalData.cloudEnvId, traceUser: true });
    }

    // 2A：本地演示模式初始化（正式发布前确认 demo.localMode）
    try {
      await dataService.init();
      // 被邀请人首次打开：如带有邀请码，静默绑定邀请关系（失败不打扰启动）
      await dataService.bindPendingInvite();
    } catch (e) {
      console.error('[礼单簿] 数据服务初始化失败', e);
    }
  },

  onShow(options) {
    // 热启动经分享卡片进入时同样捕获邀请码并尝试绑定
    this.captureInvite(options);
    if (dataService.bindPendingInvite) dataService.bindPendingInvite();
  },
});
