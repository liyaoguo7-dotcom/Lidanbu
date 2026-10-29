/**
 * 礼单簿 · 我的页（任务Q2 重排）
 * 顺序：① 个人资料条（头像+昵称+会员状态，点进个人资料页）
 *      ② 会员与积分卡片（点去购买页；卡内「我的积分」去积分页）
 *      ③ 横置礼单本（开关） / 导出备份（行下淡字提示；家庭共享入口只在首页）
 *      ④ 邀请分享（唯一邀请入口，原两个入口已合并为这一个）
 *      ⑤ 通知 / 意见反馈 / 常见问题 / 关于我们 / 联系客服（微信客服按钮）
 *      ⑥ 底部淡字「隐私政策｜注销账号」+ 版本号
 * 昵称默认显示按账号自动生成的昵称（BG批「礼友＋数字」，core/users.displayName 口径），不再写死"我"。
 */
const dataService = require('../../services/data-service.js');
const landscapeRoute = require('../../services/landscape-route.js');
const { tabSwipeHandlers } = require('../../services/tab-swipe.js');
const AppConfig = require('../../config/app-config.js');

/** 会员状态 → 资料条小字 / 演示切换行文字 */
const MEMBER_STATE_LABELS = { free: '免费用户', member: '会员', grace: '会员已到期（缓冲期）', expired: '会员已过期' };
const DEMO_STATE_LABELS = { free: '免费', member: '会员', grace: '会员已到期（缓冲期）', expired: '已过期' };

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

Page({
  ...tabSwipeHandlers, // CO批：左右滑动切换 tab
  data: {
    displayName: '礼友',
    avatarUrl: '',
    memberStateText: '免费用户',
    isMember: false,
    memberText: '',
    pointsBalance: 0,
    landscapeOn: false,
    demoMode: false,
    demoStateText: '',
    inviteRewardEnabled: false,
    inviteDone: 0,
    inviteMax: 0,
    unreadCount: 0,
    cancelPending: null, // { cancelAtText, remainingDays } 待注销提示（冷静期内）
    version: AppConfig.version || '',
    addMpGuideShow: false, // 「添加到我的小程序」引导条（CU批定版：只在第一次打开显示，标记 addMpGuideShown）
    addMpTutorialShow: false, // AP批：三步图文教程层
    addMpTriRight: 36, // BA批：红幅小三角的 right 偏移（px），按胶囊实测位置对准三个点；测不到用此回退值
  },

  async onLoad() {
    // CU批（用户 2026-10-29 定）：红幅只在第一次打开显示——本地记标记
    // addMpGuideShown，之后不再显示；整个删除重进会清标记、自然再提醒。
    // 微信不提供查常用接口，从常用/我的小程序里删无法检出，故只做第一次
    // 显示（取代 AS批“每次进入都显示”；旧 addMpGuideDone 仍不得读写）。
    // BA批照竞品视频去掉红幅上的 ×：点红幅开教程层。
    let shown = false;
    try { shown = !!wx.getStorageSync('addMpGuideShown'); } catch (e) { /* 读不到当没显示过 */ }
    if (!shown) {
      this.setData({ addMpGuideShow: true });
      try { wx.setStorageSync('addMpGuideShown', true); } catch (e) { /* 忽略 */ }
    }
    this._measureAddMpTri();
    await dataService.init();
    this._isAdmin = await dataService.isAdmin();
    this.setData({
      inviteRewardEnabled: !!(AppConfig.inviteReward && AppConfig.inviteReward.enabled),
      landscapeOn: landscapeRoute.readLandscapeOn(),
      demoMode: dataService.localMode, // 演示切换行只在本地演示模式出现，正式版没有
    });
    await this.refresh();
  },

  async onShow() {
    // CU批：红幅显示与否只由 onLoad 的首次标记定，onShow 不再改它——
    // 避免首进 onLoad 显示后被 onShow 覆盖；「我知道了」关掉后本会话内
    // 保持关闭，下次启动 onLoad 读标记仍关闭。
    // 开关显示与 storage 同步（横置页「返回竖屏」（原「切换回竖置样式」，2026-10-22 改名）会在那边写回 false）
    this.setData({ landscapeOn: landscapeRoute.readLandscapeOn() });
    await this.refresh();
  },

  onHide() {
    // AS批：离开我的页即结束"本次进入"，下次进来引导条重新显示
    this._mpGuideClosed = false;
  },

  async refresh() {
    // 六个区块互相独立，全部并发取（原实现逐个串行等云端，切到「我的」
    // 要等 6 趟才齐，2026-10-24 全站提速改为同一波发出、谁先回谁先上屏）
    const jobs = [];
    // ① 资料条：头像+昵称+会员状态（昵称改后全局读最新值）
    jobs.push((async () => { try {
      const p = await dataService.getProfile();
      this.setData({
        displayName: p.displayName,
        avatarUrl: p.avatarUrl || '',
      });
    } catch (e) { /* 演示期忽略 */ } })());
    jobs.push((async () => { try {
      const m = await dataService.getMembership();
      const isMember = m.state === 'member' || m.state === 'grace';
      let memberText;
      if (m.state === 'member' && m.expireAt) memberText = `会员有效期至 ${fmtDate(m.expireAt)}`;
      else if (m.state === 'grace') memberText = '会员已到期（缓冲期中），续费后立即恢复';
      else if (isMember) memberText = '会员有效期内';
      else memberText = '本子虽小，人情事大～开个会员，让每一笔心意都有处安放';
      this.setData({
        isMember,
        memberText,
        memberStateText: MEMBER_STATE_LABELS[m.state] || m.state,
        demoStateText: DEMO_STATE_LABELS[m.state] || m.state,
      });
    } catch (e) { /* 演示期忽略 */ } })());
    // ④ 邀请进度：已邀请 x/上限（读真实汇总，页面不写死）
    jobs.push((async () => { try {
      const s = await dataService.getInviteSummary();
      this.setData({
        inviteRewardEnabled: !!s.enabled,
        inviteDone: s.successfulInvites || 0,
        inviteMax: s.maxSuccessfulInvites || 0,
      });
    } catch (e) { /* 忽略 */ } })());
    // 通知未读数（顺带触发会员三提醒判定，见 core/notify）+ 待注销提示
    jobs.push((async () => { try {
      const unreadCount = await dataService.getUnreadCount();
      this.setData({ unreadCount });
    } catch (e) { /* 忽略 */ } })());
    // 积分余额（会员与积分卡展示；积分不过期，与会员状态无关）
    jobs.push((async () => { try {
      const pointsBalance = await dataService.getPointsBalance();
      this.setData({ pointsBalance });
    } catch (e) { /* 忽略 */ } })());
    jobs.push((async () => { try {
      const st = await dataService.getCancellationStatus();
      if (st.status === 'pendingCancel') {
        this.setData({
          cancelPending: {
            cancelAtText: fmtDate(st.cancelAt),
            remainingDays: st.remainingDays,
          },
        });
      } else {
        this.setData({ cancelPending: null });
      }
    } catch (e) { /* 忽略 */ } })());
    await Promise.all(jobs);
  },

  /** 演示专用：切换会员状态（免费/会员/会员已到期），切换后全局按新状态走现行规则 */
  onDemoMembership() {
    const modes = ['free', 'member', 'grace'];
    wx.showActionSheet({
      itemList: ['免费', '会员', '会员已到期（缓冲期）'],
      success: async (res) => {
        try {
          const state = await dataService.setDemoMembership(modes[res.tapIndex]);
          wx.showToast({ title: '已切换为：' + (DEMO_STATE_LABELS[state] || state), icon: 'none' });
          await this.refresh();
        } catch (e) {
          wx.showToast({ title: e.message || '切换失败', icon: 'none' });
        }
      },
    });
  },

  // ---- 「添加到我的小程序」引导（AP批形态，AS批改出现规则，BA批按竞品视频复刻呈现） ----

  /** BE批：红幅顶边小三角横向对准胶囊里的三个点——按胶囊实测位置算
   * right 偏移。2026-10-27 真机截图量测：三个点中心约在胶囊左缘起
   * 24% 宽处，旧口径对准胶囊正中（分隔线）会偏右约 63/976 屏宽。
   * （红幅右缘距屏右 12px、三角宽 10px，偏移以红幅右缘为基准） */
  _measureAddMpTri() {
    try {
      const rect = typeof wx.getMenuButtonBoundingClientRect === 'function'
        ? wx.getMenuButtonBoundingClientRect() : null;
      const win = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
      if (rect && win && rect.width && win.windowWidth) {
        const centerFromRight = win.windowWidth - (rect.left + rect.width * 0.24);
        const right = Math.max(8, Math.round(centerFromRight - 12 - 5));
        this.setData({ addMpTriRight: right });
      }
    } catch (e) { /* 测不到用回退偏移，不拦显示 */ }
  },

  /** 点引导条 → 打开三步图文教程层 */
  onOpenAddMpTutorial() {
    this.setData({ addMpTutorialShow: true });
  },

  /** 教程层「我知道了」：关教程层与红条；CU批后红条只在第一次打开显示（标记已在首次显示时记下），之后不再出现 */
  onAddMpKnow() {
    this._mpGuideClosed = true;
    this.setData({ addMpTutorialShow: false, addMpGuideShow: false });
  },

  onProfile() {
    wx.navigateTo({ url: '/pages/mine/profile' });
  },

  onPurchase() {
    wx.navigateTo({ url: '/pages/member/purchase/purchase' });
  },

  async onLandscapeToggle() {
    const next = !this.data.landscapeOn;
    // 任务AE 第 2 项：关不验会员（关一个开关不需要会员），只有「开」才过门禁。
    // AM批两道闸：先总开关（关→谁都开不了），再会员功能名单（含 landscapeMode
    // 才拦非会员）；名单取不到按含处理（宁可拦住）。
    if (next) {
      const flags = await dataService.getFeatureFlags().catch(() => null);
      if (flags && flags.landscape === false) {
        wx.showToast({ title: '横置礼单本暂未开放', icon: 'none' });
        return;
      }
      const landOnly = !flags || !Array.isArray(flags.memberOnly) || flags.memberOnly.includes('landscapeMode');
      if (landOnly && !this.data.isMember) {
      wx.showModal({
        title: '会员专属功能',
        content: '「横置礼单本」是会员专属功能，开通会员后即可使用。',
        confirmText: '去看看',
        cancelText: '再想想',
        success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/member/member-home' }); },
        });
        return;
      }
    }
    this.setData({ landscapeOn: next });
    landscapeRoute.writeLandscapeOn(next);
    wx.showToast({ title: next ? '横置模式已开启' : '已回到竖置模式', icon: 'none' });
  },

  onInviteReward() {
    wx.navigateTo({ url: '/pages/invite/invite-reward' });
  },

  onNotifications() {
    wx.navigateTo({ url: '/pages/mine/notifications' });
  },

  onPoints() {
    wx.navigateTo({ url: '/pages/mine/points/points' });
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/mine/feedback' });
  },

  onFaq() {
    wx.navigateTo({ url: '/pages/mine/faq' });
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/mine/about' });
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onLogout() {
    wx.navigateTo({ url: '/pages/mine-cancel/mine-cancel' });
  },

  // 老板平台隐藏入口：连点版本号 5 次进入。任务AF 起入口显隐只认服务端
  // 判定（onLoad 时问一次 isAdmin）：非管理员连点——不计数、不提示、不跳转，
  // 像什么都没装一样；管理员才走连点逻辑（管理页自身另有服务端校验兜底）。
  _versionTaps: 0,
  _versionTimer: null,
  _isAdmin: false,
  onVersionTap() {
    if (!this._isAdmin) return;
    this._versionTaps += 1;
    clearTimeout(this._versionTimer);
    this._versionTimer = setTimeout(() => { this._versionTaps = 0; }, 2000);
    if (this._versionTaps >= 5) {
      this._versionTaps = 0;
      wx.navigateTo({ url: '/pages/admin/admin-home/admin-home' });
    }
  },
});
