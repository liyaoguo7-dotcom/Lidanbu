/**
 * 礼单簿 · 应用入口
 * T0.1：Tab2 名称从配置读取并动态设置（不得写死）；云开发初始化占位（阶段1 接入）。
 */
const AppConfig = require('./config/app-config.js');

App({
  globalData: {
    config: AppConfig,
    // 云开发环境 ID：用户提供后填入（见 T0.3 报告需用户提供的信息清单）
    cloudEnvId: '',
  },

  onLaunch() {
    // Tab2（往来）名称暂定，放配置：启动时从配置读取并动态设置 tabBar
    const wanglaiTab = AppConfig.tabs[1];
    if (wanglaiTab && typeof wx.setTabBarItem === 'function') {
      wx.setTabBarItem({
        index: 1,
        text: wanglaiTab.name,
      });
    }

    // 云开发初始化（环境 ID 待用户提供后启用）
    // if (this.globalData.cloudEnvId && wx.cloud) {
    //   wx.cloud.init({ env: this.globalData.cloudEnvId, traceUser: true });
    // }
  },
});
