/**
 * 礼单簿 · 会员与积分购买页（任务P2：套餐与积分礼包同页）
 *
 * 价格/赠分/礼包全部从配置读（老板平台配置优先），本页不写死任何数字；
 * 显示价按本机平台取（安卓价/苹果价），用户只看到自己平台的价；
 * 视图状态（下架过滤、非会员礼包置灰、平台开关）由 services/purchase-view
 * 的纯函数算好，页面只渲染。平台开关在 data-service 侧合并配置后判定，
 * 本页只读结果：关闭时隐藏购买按钮、改显配置里的大白话提示。
 * 购买走真适配器：付款前弹窗明示退款规则 → 服务端建单签名 →
 * 前端调 wx.requestVirtualPayment → 前端 success 不等于发货，轮询订单
 * 等平台发货推送；本地演示仍为模拟支付（直接发货）。
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
    refundNotice: '',
    isDemo: false,
    buyingId: '', // 下单互锁（套餐/礼包共用：处理中时另一边点按被挡住）
    buyingPlan: false, // 仅套餐按钮的“处理中”显示
    buyingPack: false, // 仅礼包按钮的“处理中”显示
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
          refundNotice: d.refundNotice,
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
        refundNotice: (AppConfig.payment && AppConfig.payment.refundNotice) || '',
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
        refundNotice: d.refundNotice || '',
        isDemo: !!d.isDemo,
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

  /** 付款前明示退款规则（真适配器批）：弹窗确认后才下单；无文案时直接放行 */
  confirmRefundNotice() {
    const notice = this.data.refundNotice;
    if (!notice) return Promise.resolve(true);
    return new Promise((resolve) => {
      try {
        wx.showModal({
          title: '购买前请确认',
          content: notice,
          confirmText: '确认购买',
          cancelText: '再想想',
          success: (res) => resolve(!!(res && res.confirm)),
          fail: () => resolve(false),
        });
      } catch (e) { resolve(false); }
    });
  },

  /** 取一次登录码（供服务端换 session_key 签名用；失败返回空串，服务端会报错提示重进） */
  loginCode() {
    return new Promise((resolve) => {
      try {
        wx.login({ success: (res) => resolve((res && res.code) || ''), fail: () => resolve('') });
      } catch (e) { resolve(''); }
    });
  },

  /** 调起微信虚拟支付（iOS 需微信 >= 8.0.68 且已配简称开 Apple 支付） */
  requestVirtualPay(payParams) {
    return new Promise((resolve) => {
      if (typeof wx.requestVirtualPayment !== 'function') {
        resolve({ status: 'unsupported' });
        return;
      }
      try {
        wx.requestVirtualPayment({
          signData: payParams.signData,
          paySig: payParams.paySig,
          signature: payParams.signature,
          mode: payParams.mode || 'short_series_goods',
          success: () => resolve({ status: 'success' }),
          fail: () => resolve({ status: 'fail' }),
          cancel: () => resolve({ status: 'cancel' }),
        });
      } catch (e) { resolve({ status: 'fail' }); }
    });
  },

  /** 轮询订单发货状态（前端 success 不等于发货，等平台发货推送；约 30 秒） */
  async pollOrderPaid(orderId) {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const o = await dataService.getOrder(orderId);
        if (o && o.status === 'paid') return true;
      } catch (e) { /* 轮询失败继续 */ }
    }
    return false;
  },

  /**
   * 真实支付收尾：调起 → 成功则轮询发货。返回 'paid'（已发货）/
   * 'pending'（已付款、等待发货确认）/ 'failed'（未付款，已提示）。
   */
  async payAndWait(r) {
    const res = await this.requestVirtualPay(r.payParams);
    if (res.status === 'success') {
      const orderId = r.order && r.order.id;
      if (!orderId) return 'pending';
      return (await this.pollOrderPaid(orderId)) ? 'paid' : 'pending';
    }
    if (res.status === 'cancel') wx.showToast({ title: '已取消支付', icon: 'none' });
    else if (res.status === 'unsupported') wx.showToast({ title: '当前微信版本不支持虚拟支付，请升级微信后重试', icon: 'none' });
    else wx.showToast({ title: '支付失败，请重试', icon: 'none' });
    return 'failed';
  },

  async onBuyPlan() {
    const planId = this.data.selectedPlanId;
    if (!planId || this.data.buyingId) return;
    if (!(await this.confirmRefundNotice())) return;
    this.setData({ buyingId: planId, buyingPlan: true, doneText: '' });
    try {
      const code = await this.loginCode();
      const r = await dataService.purchaseMembership(planId, { platform: this.devicePlatform(), loginCode: code });
      if (r.delivered) {
        this.setData({ doneText: '开通成功！会员已经生效，赠送的积分也到账啦。' });
        wx.showToast({ title: '开通成功', icon: 'success' });
        await this.refresh();
      } else if (r.pendingPay) {
        const outcome = await this.payAndWait(r);
        if (outcome === 'paid') {
          this.setData({ doneText: '开通成功！会员已经生效，赠送的积分也到账啦。' });
          wx.showToast({ title: '开通成功', icon: 'success' });
          await this.refresh();
        } else if (outcome === 'pending') {
          this.setData({ doneText: '支付成功，系统正在确认，稍后在「我的订单」里查看到账状态。' });
          wx.showToast({ title: '支付成功，等待确认', icon: 'none' });
        }
      } else {
        wx.showToast({ title: '支付未完成，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
    this.setData({ buyingId: '', buyingPlan: false });
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
    if (!(await this.confirmRefundNotice())) return;
    this.setData({ buyingId: packId, buyingPack: true, doneText: '' });
    try {
      const code = await this.loginCode();
      const r = await dataService.purchasePointsPack(packId, { platform: this.devicePlatform(), loginCode: code });
      if (r.delivered) {
        this.setData({ doneText: '购买成功！积分已经到账，去「我的—积分」能看到这笔流水。' });
        wx.showToast({ title: '购买成功', icon: 'success' });
        await this.refresh();
      } else if (r.pendingPay) {
        const outcome = await this.payAndWait(r);
        if (outcome === 'paid') {
          this.setData({ doneText: '购买成功！积分已经到账，去「我的—积分」能看到这笔流水。' });
          wx.showToast({ title: '购买成功', icon: 'success' });
          await this.refresh();
        } else if (outcome === 'pending') {
          this.setData({ doneText: '支付成功，系统正在确认，稍后在「我的订单」里查看到账状态。' });
          wx.showToast({ title: '支付成功，等待确认', icon: 'none' });
        }
      } else {
        wx.showToast({ title: '支付未完成，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
    this.setData({ buyingId: '', buyingPack: false });
  },

  onPoints() {
    wx.navigateTo({ url: '/pages/mine/points/points' });
  },

  onOrders() {
    wx.navigateTo({ url: '/pages/member/orders/orders' });
  },
});
