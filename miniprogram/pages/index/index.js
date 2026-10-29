/**
 * 礼单簿 · 首页（阶段2 2A）
 * 顶部 4 金刚区 + 中部送礼/收礼 2 大卡；小喇叭文案按用户决定。
 * 家庭共享/拍照导入为会员专属，普通用户点进会员介绍。
 * 任务Q2：静默初始化失败时顶部出重试条（点条调 app.retryInit）；首次打开
 * 先过一遍引导页（只显示一次）；隐私弹窗首次弹出（privacy-modal），
 * 拍照导入进入前走页面层隐私守卫（privacy-guard，未同意先弹窗）。
 */
const dataService = require('../../services/data-service.js');
const hornState = require('../../services/horn-state.js');
const { hornMarquee } = require('../../services/horn-marquee.js');
const privacyGuard = require('../../services/privacy-guard.js');
const { tabSwipeHandlers } = require('../../services/tab-swipe.js');
const guideState = require('../../services/guide-state.js');
const { formatAmountInt } = require('../../core/format.js');

Page({
  ...tabSwipeHandlers, // CO批：左右滑动切换 tab
  data: {
    hornOff: false, hornRun: false, hornDur: 0, // 小喇叭：关闭（本次打开期间）/长文字慢速左滚（任务AB）
    tipText: '点击拍照导入，可一键识别纸质礼单',
    entries: [
      { id: 'share', icon: '/images/icons/family.svg', name: '家庭共享' },
      { id: 'photo', icon: '/images/icons/camera.svg', name: '拍照导入' },
      { id: 'invite', icon: '/images/icons/mail.svg', name: '电子请柬' },
      { id: 'export', icon: '/images/icons/export.svg', name: '导出备份' },
    ],
    isMember: false,
    initFailed: false,     // 静默初始化失败 → 显示重试条
    privacyShow: false,    // 隐私弹窗是否显示
    privacyDeclined: false, // 已弹过窗且未同意 → 显示委婉说明条（只读浏览保留）
    pendingPhoto: false,   // 弹窗同意后要续走的拍照导入
    monthSummary: null,    // 本月小结（任务V）：{hasRecords, receiveText, giftText}
    recent: [],            // 最近往来：取最近 10 条（任务AA）；空数组时整卡不渲染
    recentRolling: false,  // 任务AA：>4 条时竖向自动滚动（同时可见 4 条），不足则静态
    homeLoaded: false,     // AP批：首页数据已回来才判最近往来空/非空（防标语块闪现）
    homeLoading: false,    // BW批：无缓存首次加载时显示「加载中…」，不留空白
    slogans: [             // AP批 痛点标语（用户 2026-10-26 定稿，一字不差）
      '今年你送出去了多少礼？',
      '出门在外，想查往来却找不到礼簿？',
      '纸质礼簿越记越厚，翻找一笔好费劲？',
    ],
    sloganIdx: 0,          // AP批：当前轮播到第几句（约 3 秒一切，淡入淡出）
  },

  // ---- 小喇叭（统一规格 任务AB：常驻不闪烁、长文字慢速左滚，点 × 本次打开期间不再显示） ----
  /** 长文字慢速左滚判定（任务AB 第 8 项）：按当前 tipText 算，超宽才滚 */
  _syncHorn() { const m = hornMarquee(this.data.tipText, { fontPx: 14, avail: 284 }); this.setData({ hornRun: m.run, hornDur: m.dur }); },
  onHornClose() { hornState.dismiss('index'); this.setData({ hornOff: true }); },

  async onLoad() {
    this.setData({ hornOff: hornState.isDismissed('index') }); this._syncHorn();
    // 电子请柬（任务AF）：合作小程序 AppID 未配置时入口整个不显示，
    // 不再露一个点了只报「敬请期待」的空入口；配置好自动出现。
    // 2026-10-25 加总开关：老板平台关掉电子请柬后，即使配了 AppID 也不显示（双条件）。
    const ext = dataService.getExternalInvitation();
    const flags0 = await dataService.getFeatureFlags().catch(() => null);
    if (!ext || !ext.appId || (flags0 && flags0.eInvitation === false)) {
      this.setData({ entries: this.data.entries.filter((e) => e.id !== 'invite') });
    }
    const r = await dataService.init();
    this.setData({ initFailed: !(r && r.ok) });
    // 维护模式分流（AL-7）：开启时非管理员导向维护页；管理员不受限。
    // 服务端接口层另有停服兜底（api 分发），这里是入口体验层。
    try {
      const mflags = await dataService.getFeatureFlags();
      if (mflags && mflags.maintenance && !(await dataService.isAdmin())) {
        wx.reLaunch({ url: '/pages/maintenance/maintenance' });
        return;
      }
    } catch (e) { /* 状态取不到按正常流程走 */ }
    // 首次使用引导：只显示一次（storage 标记），未看过先去引导页
    const entry = guideState.resolveGuideEntry({ seen: guideState.readSeen() });
    if (entry.enter) {
      wx.navigateTo({ url: '/pages/guide/guide' });
    }
    await this.refreshMember();
    await this.refreshHomeData();
  },

  async onShow() {
    // 会员状态与首页数据并发（原来串行排队，首页联系人/小结都跟着等）
    await Promise.all([this.refreshMember(), this.refreshHomeData()]);
    await this.checkPrivacyPopup();
  },

  onHide() { this._stopSlogan(); },
  onUnload() { this._stopSlogan(); },

  // ---- AP批 痛点标语轮播：只在最近往来为空时转，约 3 秒一句；离开页面停 ----
  _startSlogan() {
    if (this._sloganTimer) return;
    this._sloganTimer = setInterval(() => {
      this.setData({ sloganIdx: (this.data.sloganIdx + 1) % this.data.slogans.length });
    }, 3000);
  },
  _stopSlogan() {
    if (this._sloganTimer) { clearInterval(this._sloganTimer); this._sloganTimer = null; }
  },

  /** 标语块整块可点 → 去记第一笔（添加送礼页） */
  onSloganTap() {
    wx.navigateTo({ url: '/pages/gift-add/gift-add' });
  },

  // ---- BW批：首页缓存秒显（小结＋最近往来） ----
  // 根因：每次 onShow 都重查云端，查回来的 1-2 秒里 recent=[]、卡片不渲染，
  // 看着就是姓名没了、然后又出来。修法：上次查回来的先存本地，进页先秒显，
  // 后台再静默重查、拿到新的换上（与横置 BV2 快照同一思路）。
  _readHomeCache() {
    try {
      const c = wx.getStorageSync('home.cache.v1');
      if (!c || typeof c !== 'object') return null;
      const uid = (dataService.getCurrentUserId && dataService.getCurrentUserId()) || '';
      if (uid && c.uid !== uid) return null; // 换号不闪旧账
      if (!c.monthSummary || !Array.isArray(c.recent)) return null;
      return c;
    } catch (e) { return null; }
  },
  _writeHomeCache(monthSummary, recent) {
    try {
      const uid = (dataService.getCurrentUserId && dataService.getCurrentUserId()) || '';
      wx.setStorageSync('home.cache.v1', { uid, monthSummary, recent });
    } catch (e) { /* 忽略 */ }
  },
  _applyHomeData(monthSummary, recent) {
    const list = recent || [];
    this.setData({
      monthSummary,
      recent: list,
      recentRolling: list.length > 4,
      homeLoaded: true,
      homeLoading: false,
    }, () => {
      // 最近往来为空才轮播标语；一有数据立即停并撤块（wxml 条件控制）
      if (list.length === 0) this._startSlogan(); else this._stopSlogan();
    });
  },

  /** 本月小结 + 最近往来（任务V）：只读本人账本真实数据（data-service 口径） */
  async refreshHomeData() {
    const cached = this._readHomeCache();
    if (cached) {
      this._applyHomeData(cached.monthSummary, cached.recent);
    } else {
      this.setData({ homeLoading: true });
    }
    try {
      const [s, recent] = await Promise.all([
        dataService.getHomeSummary(),
        dataService.getHomeRecent(10),
      ]);
      const monthSummary = {
        hasRecords: !!s.hasRecords,
        receiveText: formatAmountInt(s.receiveFen),
        giftText: formatAmountInt(s.giftFen),
      };
      const list = recent || [];
      this._writeHomeCache(monthSummary, list);
      this._applyHomeData(monthSummary, list);
    } catch (e) {
      // 静默刷新失败：有缓存就留着旧的（不清空、不弹错）；没缓存才判加载完成走标语空态
      this.setData({ homeLoaded: true, homeLoading: false });
    }
  },

  /** 最近往来「查看全部」→ 往来 Tab */
  goWanglai() {
    wx.switchTab({ url: '/pages/wanglai/wanglai' });
  },

  /** 最近往来行点击 → 对应记录详情页 */
  onRecentTap(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  async refreshMember() {
    try {
      const m = await dataService.getMembership();
      this.setData({ isMember: m.state === 'member' || m.state === 'grace' });
    } catch (e) { /* 演示期忽略 */ }
  },

  /** 重试条：重新静默初始化（app.retryInit），成功后收起重试条 */
  async onRetryInit() {
    const app = getApp();
    let state = null;
    if (app && typeof app.retryInit === 'function') {
      state = await app.retryInit();
    } else {
      const r = await dataService.init();
      state = { status: r && r.ok ? 'ready' : 'failed' };
    }
    if (state && state.status === 'ready') {
      this.setData({ initFailed: false });
      await this.refreshMember();
    } else {
      wx.showToast({ title: '还是不太顺，请再试一次', icon: 'none' });
    }
  },

  /** 隐私弹窗首次判定：没展示过标记且后端未同意才弹；弹过且没同意则出说明条 */
  async checkPrivacyPopup() {
    if (this._privacyChecking || this.data.privacyShow) return;
    this._privacyChecking = true;
    try {
      const consent = await dataService.getPrivacyConsent();
      const agreed = !!(consent && consent.agreed);
      this._consentAgreed = agreed;
      const localShown = privacyGuard.readPopupShown();
      if (privacyGuard.needsFirstPopup({ localShown, backendAgreed: agreed })) {
        this.setData({ privacyShow: true });
      } else if (!agreed && localShown) {
        this.setData({ privacyDeclined: true });
      }
    } catch (e) { /* 忽略 */ }
    this._privacyChecking = false;
  },

  async onPrivacyAgree() {
    try { await dataService.setPrivacyConsent(true); } catch (e) { /* 忽略 */ }
    privacyGuard.markPopupShown();
    this._consentAgreed = true;
    const goPhoto = this.data.pendingPhoto;
    this.setData({ privacyShow: false, privacyDeclined: false, pendingPhoto: false });
    if (goPhoto) wx.navigateTo({ url: '/pages/import/import-home' });
  },

  onPrivacyDisagree() {
    privacyGuard.markPopupShown();
    this.setData({ privacyShow: false, privacyDeclined: true, pendingPhoto: false });
  },

  onPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onPrivacyAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  memberOnly(feature) {
    const labels = { share: '家庭共享邀请', photo: '拍照导入' };
    wx.showModal({
      title: '会员专属功能',
      content: `「${labels[feature] || feature}」是会员专属功能，开通会员后即可使用。`,
      confirmText: '去看看',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) wx.switchTab({ url: '/pages/mine/mine' });
      },
    });
  },

  /** 拍照导入：进入前先过页面层隐私守卫——未同意先弹隐私窗，同意后续走 */
  async goPhotoImport() {
    let agreed = this._consentAgreed;
    if (agreed === undefined) {
      try {
        const c = await dataService.getPrivacyConsent();
        agreed = !!(c && c.agreed);
        this._consentAgreed = agreed;
      } catch (e) { agreed = false; }
    }
    const verdict = privacyGuard.evaluate({ agreed }, 'photoImport');
    if (!verdict.allowed) {
      this.setData({ privacyShow: true, pendingPhoto: true });
      return;
    }
    wx.navigateTo({ url: '/pages/import/import-home' });
  },

  /** 电子请柬：跳转合作小程序（自制请柬已取消）；未配置目标时提示敬请期待 */
  goExternalInvitation() {
    const ext = dataService.getExternalInvitation();
    if (!ext || !ext.appId) {
      wx.showToast({ title: '敬请期待', icon: 'none' });
      return;
    }
    wx.navigateToMiniProgram({ appId: ext.appId, path: '' });
  },

  async onEntry(e) {
    const id = e.currentTarget.dataset.id;
    if (id === 'photo') {
      // 拍照导入总闸（任务AF）：开关关闭时谁点都只提示敬请期待，
      // 不进会员判断、不进隐私守卫、不打开导入页（服务端另有拒绝兜底）
      const flags = await dataService.getFeatureFlags();
      if (!flags.photoImport) {
        wx.showToast({ title: '拍照导入敬请期待', icon: 'none' });
        return;
      }
    }
    if (id === 'share') {
      // 家庭共享总闸（2026-10-25）：关掉时谁点都只提示敬请期待（与拍照总闸同构，先于会员判断）
      const flags = await dataService.getFeatureFlags();
      if (!flags.familyShare) {
        wx.showToast({ title: '家庭共享敬请期待', icon: 'none' });
        return;
      }
    }
    if ((id === 'share' || id === 'photo') && !this.data.isMember) {
      // 会员功能名单（AM批接上）：名单含该功能才拦非会员；不含则免费用户也能用。
      // 名单取不到时按含处理（宁可拦住，与接线前行为一致）。
      const key = id === 'share' ? 'familyShareInvite' : 'photoImport';
      const mflags = await dataService.getFeatureFlags().catch(() => null);
      const only = !mflags || !Array.isArray(mflags.memberOnly) || mflags.memberOnly.includes(key);
      if (only) {
        this.memberOnly(id);
        return;
      }
    }
    if (id === 'share') { wx.navigateTo({ url: '/pages/share/share-home' }); return; }
    if (id === 'photo') { this.goPhotoImport(); return; }
    if (id === 'invite') { this.goExternalInvitation(); return; }
    if (id === 'export') { wx.navigateTo({ url: '/pages/export/export-home' }); return; }
  },

  goGifts() {
    wx.navigateTo({ url: '/pages/gifts/gifts' });
  },

  goReceive() {
    wx.navigateTo({ url: '/pages/receive/receive' });
  },
});
