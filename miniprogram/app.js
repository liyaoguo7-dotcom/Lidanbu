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
    // 顶部条形弹窗的"打开周期"计数（AS批）：App 每次前台化（冷启动的
    // onShow、热启动回到前台）+1；top-banner 组件按周期弹一次，同周期
    // 不重复。两者都只存内存（globalData），关掉小程序即清零——
    // 绝不落 storage（旧版模块级标志在一进程内永不重置、storage 标志要
    // 删小程序才清，都被用户点名改掉）。
    appShowTick: 0,
    topBannerShownTick: -1,
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
      // 被邀请人首次打开：如带有 inviter 参数，静默绑定邀请关系（失败不打扰启动）
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

  /** 捕获分享进入时携带的邀请人参数（path 上的 inviter 参数，用户不可见；
   *  任务Z 第 5 项去码化后唯一入口），存起来待 init 后静默绑定 */
  captureInvite(options) {
    const q = (options && options.query) || {};
    const inviter = q.inviter;
    if (inviter) dataService.setPendingInviteCode(inviter);
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

    // 横置字体分包预下载（任务AB 第 6 项）：启动即后台拉 fonts 分包（名称与
    // app.json subpackages 的 name 一致），用户进横置页时字体文件已就位，
    // loadFontFace/@font-face 不必再等分包下载；API 不存在/失败一律静默。
    if (typeof wx.preDownloadSubpackage === 'function') {
      try {
        wx.preDownloadSubpackage({ name: 'fonts', success: () => {}, fail: () => {} });
      } catch (e) { /* 忽略 */ }
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
    // AS批：前台化周期 +1（冷启动 onLaunch 后也会走一次 onShow），
    // 顶部条形弹窗据此每周期弹一次
    this.globalData.appShowTick += 1;
    // 热启动经分享卡片进入时同样捕获 inviter 参数并尝试绑定
    this.captureInvite(options);
    if (dataService.bindPendingInvite) dataService.bindPendingInvite();
  },
});
