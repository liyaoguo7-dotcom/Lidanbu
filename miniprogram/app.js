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
    // 静默初始化状态（任务Q1）：{status:'starting'|'ready'|'failed', reason?}
    // 失败不拦启动、不弹登录框；首页读这个状态显示"网络不太顺，点这里重试"条，
    // 点条调 retryInit()。没有登录页、没有登录拦截，这是唯一状态来源。
    initState: { status: 'starting' },
  },

  /** 静默初始化：成功置 ready 并绑定待处理邀请码；失败置 failed（reason=network） */
  async runInit() {
    let r = null;
    try {
      r = await dataService.init();
    } catch (e) {
      r = { ok: false, reason: 'network' };
    }
    if (r && r.ok) {
      this.globalData.initState = { status: 'ready' };
      // 被邀请人首次打开：如带有邀请码，静默绑定邀请关系（失败不打扰启动）
      try { await dataService.bindPendingInvite(); } catch (e) { /* 忽略 */ }
    } else {
      this.globalData.initState = { status: 'failed', reason: (r && r.reason) || 'network' };
    }
    return this.globalData.initState;
  },

  /** 首页重试条调用：重新静默初始化，返回最新 initState */
  async retryInit() {
    return this.runInit();
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

    // 静默初始化（任务Q1）：直接进首页、后台建/取身份，失败只置状态不拦截
    await this.runInit();
    this.watchNetwork();
  },

  /** 弱网/离线提示（大白话）：本地模式数据本来就在本机，断网可继续记；
   *  云模式断网时提示联网后再试。只在网络状态变化时提示，不反复打扰。 */
  watchNetwork() {
    if (typeof wx === 'undefined' || !wx.onNetworkStatusChange) return;
    const local = !!(AppConfig.demo && AppConfig.demo.localMode);
    const hint = local
      ? '现在没有网络，礼单簿可以先记在本机，数据都在你的手机里'
      : '现在没有网络，联网后再试一次吧';
    wx.onNetworkStatusChange((res) => {
      if (!res.isConnected) wx.showToast({ title: hint, icon: 'none', duration: 2600 });
    });
    if (wx.getNetworkType) {
      wx.getNetworkType({
        success: (res) => {
          if (res.networkType === 'none') wx.showToast({ title: hint, icon: 'none', duration: 2600 });
        },
      });
    }
  },

  onShow(options) {
    // 热启动经分享卡片进入时同样捕获邀请码并尝试绑定
    this.captureInvite(options);
    if (dataService.bindPendingInvite) dataService.bindPendingInvite();
  },
});
