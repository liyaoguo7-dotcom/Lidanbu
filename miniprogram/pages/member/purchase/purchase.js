/**
 * 礼单簿 · 会员与积分购买页（任务P2：套餐与积分礼包同页）
 *
 * 价格/赠分/礼包全部从配置读（老板平台配置优先），本页不写死任何数字；
 * 视图状态（下架过滤、非会员礼包置灰、平台开关）由 services/purchase-view
 * 的纯函数算好，页面只渲染。平台开关在 data-service 侧合并配置后判定，
 * 本页只读结果：关闭时隐藏购买按钮、改显配置里的大白话提示。
 * 购买走 core/payment 的建单→调起→回调发货链路；本地演示为模拟支付，
 * 真实环境换微信虚拟支付适配器，本页不改。
 */
const dataService = require('../../../services/data-service.js');
const AppConfig = require('../../../config/app-config.js');
const { buildPurchaseView } = require('../../../services/purchase-view.js');

const STATE_TEXT = {
  free: '免费用户',
  member: '会员中',
  grace: '会员已到期（缓冲期）',
  expired: '会员已过期',
};

Page({
  data: {
    loading: true,
    stateText: '',
    expireText: '',
    pointsBalance: 0,
    photoImportCost: 0,
    plans: [],
    packs: [],
    selectedPlanId: '',
    selectedPackId: '',
    packsLocked: true,
    buyEnabled: true,
    platformDisabledTip: '',
    buyingId: '',
    doneText: '',
    hydrated: false, // 真数据（服务端配置/会员状态）是否已到达
  },

  async onLoad() {
    this.paintStatic();
    this.restoreCache();
    await dataService.init();
    await this.refresh();
  },

  /** 上次数据秒显（2026-10-25 真机反馈：方块立刻出、数据晚约 1 秒）：
   * 进页先把上次打开时存下的数据整页摆出来（价格/会员状态/积分余额），
   * 后台 refresh() 拿到新数据再整页替换——第二次起打开就没有那一秒的
   * 数据空白。缓存只影响显示：购买按钮仍等真数据到达（hydrated）才出现，
   * 且下单时服务端再验开关与价格，不会按旧数据成交。缓存超 7 天不用。 */
  restoreCache() {
    try {
      const c = wx.getStorageSync('purchasePageCacheV1');
      if (!c || !c.data || !c.at || Date.now() - c.at > 7 * 86400e3) return;
      this.setData({ ...c.data, loading: false });
    } catch (e) { /* 读缓存失败不拦正常加载 */ }
  },

  saveCache() {
    try {
      const d = this.data;
      wx.setStorageSync('purchasePageCacheV1', {
        at: Date.now(),
        data: {
          stateText: d.stateText, expireText: d.expireText,
          pointsBalance: d.pointsBalance, photoImportCost: d.photoImportCost,
          plans: d.plans, packs: d.packs, packsLocked: d.packsLocked,
          buyEnabled: d.buyEnabled, platformDisabledTip: d.platformDisabledTip,
          selectedPlanId: d.selectedPlanId, selectedPackId: d.selectedPackId,
        },
      });
    } catch (e) { /* 存缓存失败不影响购买 */ }
  },

  /** 先出方块（2026-10-24 真机反馈：套餐要等 3~4 秒才出现）：进页先用
   * 静态默认配置同步渲染套餐/礼包方块（数值与服务端默认一致），真数据
   * 到达后由 refresh() 整页替换为生效值（老板平台改过的以服务端为准）。
   * 购买按钮等真数据到达（hydrated）才出现，杜绝拿旧开关状态下单。 */
  paintStatic() {
    try {
      const view = buildPurchaseView({
        plans: AppConfig.pricing || [],
        packs: (AppConfig.points && AppConfig.points.packs) || [],
        state: 'free',
        purchaseEnabled: true,
      });
      const hot = view.plans.find((p) => p.recommended);
      this.setData({
        loading: false,
        stateText: '加载中…',
        plans: view.plans,
        packs: view.packs,
        selectedPlanId: (hot && hot.id) || (view.plans[0] && view.plans[0].id) || '',
        selectedPackId: (view.packs[0] && view.packs[0].id) || '',
        packsLocked: true,
      });
    } catch (e) { /* 静态渲染失败不拦真数据加载 */ }
  },

  /** 本机平台（'ios'/'android'/…）：只用来问配置开关，判断逻辑不在本页 */
  devicePlatform() {
    try {
      const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
      return String((info && info.platform) || '').toLowerCase();
    } catch (e) { return ''; }
  },

  async refresh() {
    try {
      const d = await dataService.getPurchasePageData(this.devicePlatform());
      const view = buildPurchaseView({
        plans: d.plans, packs: d.packs, state: d.state, purchaseEnabled: d.purchaseEnabled,
      });
      // 方块选中态：保留已有选择（仍在架上时），否则默认选「推荐」套餐/第一档礼包
      const planIds = view.plans.map((p) => p.id);
      const packIds = view.packs.map((p) => p.id);
      const hot = view.plans.find((p) => p.recommended);
      const selectedPlanId = planIds.includes(this.data.selectedPlanId)
        ? this.data.selectedPlanId : ((hot && hot.id) || planIds[0] || '');
      const selectedPackId = packIds.includes(this.data.selectedPackId)
        ? this.data.selectedPackId : (packIds[0] || '');
      this.setData({
        loading: false,
        hydrated: true,
        stateText: STATE_TEXT[d.state] || d.state,
        expireText: d.expireAt ? new Date(d.expireAt).toLocaleDateString('zh-CN') : '',
        pointsBalance: d.pointsBalance,
        photoImportCost: d.photoImportCost,
        plans: view.plans,
        packs: view.packs,
        selectedPlanId,
        selectedPackId,
        packsLocked: view.packsLocked,
        buyEnabled: view.buyEnabled,
        platformDisabledTip: d.platformDisabledTip,
      }, () => this.saveCache());
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onSelectPlan(e) {
    this.setData({ selectedPlanId: e.currentTarget.dataset.id });
  },

  onSelectPack(e) {
    // 非会员：礼包置灰，点按只给委婉提示并滚到套餐区（沿用原口径）
    if (this.data.packsLocked) {
      wx.showToast({ title: '积分礼包是会员的小福利，先开通会员就能买啦', icon: 'none' });
      wx.pageScrollTo({ selector: '#plans-section', duration: 300 });
      return;
    }
    this.setData({ selectedPackId: e.currentTarget.dataset.id });
  },

  async onBuyPlan() {
    const planId = this.data.selectedPlanId;
    if (!planId || this.data.buyingId) return;
    this.setData({ buyingId: planId, doneText: '' });
    try {
      const r = await dataService.purchaseMembership(planId);
      if (r.delivered) {
        this.setData({ doneText: '开通成功！会员已经生效，赠送的积分也到账啦。' });
        wx.showToast({ title: '开通成功', icon: 'success' });
        await this.refresh();
      } else {
        wx.showToast({ title: '支付未完成，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
    this.setData({ buyingId: '' });
  },

  async onBuyPack() {
    // 非会员时购买按钮不渲染，这里再兜底拦一次（下单层也会拒）
    if (this.data.packsLocked) {
      wx.showToast({ title: '积分礼包是会员的小福利，先开通会员就能买啦', icon: 'none' });
      wx.pageScrollTo({ selector: '#plans-section', duration: 300 });
      return;
    }
    const packId = this.data.selectedPackId;
    if (!packId || this.data.buyingId) return;
    this.setData({ buyingId: packId, doneText: '' });
    try {
      const r = await dataService.purchasePointsPack(packId);
      if (r.delivered) {
        this.setData({ doneText: '购买成功！积分已经到账，去「我的—积分」能看到这笔流水。' });
        wx.showToast({ title: '购买成功', icon: 'success' });
        await this.refresh();
      } else {
        wx.showToast({ title: '支付未完成，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
    this.setData({ buyingId: '' });
  },

  onPoints() {
    wx.navigateTo({ url: '/pages/mine/points/points' });
  },

  onOrders() {
    wx.navigateTo({ url: '/pages/member/orders/orders' });
  },
});
