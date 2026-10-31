/**
 * 礼单簿 · XX的账本（家人视角，阶段3）
 * 顶部"正在查看：XX的账本" + 淡字"仅统计已授权给你的记录"
 * 只用已授权数据计算（经 core.stats.memberStats）
 * 2026-10-31 家庭共享闭环批：
 * - 横幅下加"你被授权："＋5 个胶囊（仅展示、点它不做事），颜色与授权对应
 *   （被授权导出备份绿 #E0F3E4、未授权灰色底），授权取自 getGrantFor（实时查，无缓存）
 * - 已授权礼薄按收礼礼簿样式（橙黄渐变圆角块＋图标＋名＋日期＋共几笔｜¥金额），
 *   点收礼那本进账本主人那本的详情页，送礼被授权时也作为一行（圆圈"送"图标）
 *   点它进账本主人的送礼页；往来方块本身、权限胶囊本身不跳转
 * - 往来按往来截图：左送礼粉红块、右收礼橙黄块（名在上、金额在中、笔数在下），
 *   下边淡黄块同显合计与差额；合计范围为全部时间（字符串 'all'），
 *   旧 range {opt:'lastYear'} 会被服务端当自定义范围报错兜底 0，故改掉
 * - 链接进来的提示页：右上角叉点后回首页，底部红条（#F0575A 白字、非按钮、
 *   文案"请从家庭共享入口进入"）；从家庭共享进来时无红条、无叉，左上角箭头返回
 * - 称呼保持"家人的账本"不变；权限改后返回本页即重查（onShow），服务端本来实时查
 */
const dataService = require('../../services/data-service.js');
const { formatAmountInt } = require('../../core/format.js');
const { tagIconPath } = require('../../config/tag-icons.js');

const SWITCH_NAMES = [
  { id: 'view', name: '仅查看' },
  { id: 'add', name: '可新增' },
  { id: 'edit', name: '可修改' },
  { id: 'del', name: '可删除' },
  { id: 'export', name: '可导出' },
];

Page({
  data: {
    ownerId: '',
    ownerName: '家人',
    events: [],
    giftsOn: false,
    receiveCount: 0,
    giftCount: 0,
    giftTotalText: '0',
    totalIn: '0',
    totalOut: '0',
    totalCountText: '',
    diffText: '0',
    switches: SWITCH_NAMES.map((s) => ({ ...s, on: false })),
    fromLink: false,
  },

  async onLoad(query) {
    await dataService.init();
    let ownerId = query.ownerId || '';
    const fromLink = !!query.code;
    // 分享卡片落地：带 code（邀请码=membershipId）→ 先接受邀请再看账本（2026-10-22 邀请改走微信分享）
    if (query.code) {
      ownerId = (await this.acceptByCode(query.code)) || ownerId;
    }
    this.setData({ ownerId, fromLink });
    await this.refresh();
    this._loaded = true;
  },

  async onShow() {
    // 权限改后立即生效：返回本页即重查授权与数据（不靠缓存）；首进已在 onLoad 查过，不重复弹加载
    if (this._loaded && this.data.ownerId) await this.refresh(true);
  },

  /** 凭邀请码接受家庭共享邀请，返回账本主人 id（失败返回 ''） */
  async acceptByCode(code) {
    try {
      const ms = await dataService.getShareMembership(code);
      if (!ms) {
        wx.showToast({ title: '邀请不存在或已失效', icon: 'none' });
        return '';
      }
      const myId = dataService.getMyUserId();
      if (ms.ownerId === myId) {
        wx.showToast({ title: '这是你发出的邀请', icon: 'none' });
        return ms.ownerId;
      }
      if (ms.status === 'expired') {
        wx.showToast({ title: '邀请已失效，请让邀请人重新邀请', icon: 'none' });
        return '';
      }
      if (ms.status === 'removed') {
        wx.showToast({ title: '邀请已被移除', icon: 'none' });
        return '';
      }
      if (ms.status === 'pending') {
        await dataService.acceptShare(code);
        wx.showToast({ title: '已接受邀请', icon: 'success' });
      } else if (ms.memberId && ms.memberId !== myId) {
        wx.showToast({ title: '这份邀请已被其他人接受', icon: 'none' });
        return '';
      } else if (ms.status !== 'active') {
        wx.showToast({ title: '邀请不存在或已失效', icon: 'none' });
        return '';
      }
      return ms.ownerId;
    } catch (e) {
      wx.showModal({ title: '提示', content: e.message, showCancel: false });
      return '';
    }
  },

  async refresh(silent) {
    const ownerId = this.data.ownerId;
    if (!ownerId) return;
    if (!silent) wx.showLoading({ title: '' });
    try {
      const myId = dataService.getMyUserId();
      const isSelf = ownerId === myId;
      const [eventsRaw, list, grant] = await Promise.all([
        (isSelf
          ? dataService.listEventsWithStats().catch(() => [])
          : dataService.listMemberEvents(ownerId).catch(() => [])),
        dataService.getWanglaiList({ ownerId, range: 'all' }).catch(() => ({
          rows: [], totalReceiveFen: 0, totalGiftFen: 0,
          totalReceiveCount: 0, totalGiftCount: 0, diffFen: 0,
        })),
        (isSelf ? Promise.resolve(null) : dataService.getGrantFor(ownerId).catch(() => null)),
      ]);
      const events = (eventsRaw || []).map((e) => ({
        _id: e._id,
        name: e.name,
        date: e.date || '',
        count: e.count || 0,
        totalText: formatAmountInt(e.totalFen || 0),
        icon: tagIconPath(e.tagId),
      }));
      const switches = SWITCH_NAMES.map((s) => ({
        ...s,
        on: isSelf ? true : !!(grant && grant.switches && grant.switches[s.id]),
      }));
      const giftsOn = isSelf ? true : !!(grant && grant.scope && grant.scope.gifts);
      const totalCount = (list.totalReceiveCount || 0) + (list.totalGiftCount || 0);
      this.setData({
        events,
        switches,
        giftsOn,
        receiveCount: list.totalReceiveCount || 0,
        giftCount: list.totalGiftCount || 0,
        giftTotalText: formatAmountInt(list.totalGiftFen || 0),
        totalIn: formatAmountInt(list.totalReceiveFen || 0),
        totalOut: formatAmountInt(list.totalGiftFen || 0),
        totalCountText: `合计：${totalCount} 笔 · ${(list.rows || []).length} 位亲友`,
        diffText: formatAmountInt(Math.abs(list.diffFen || 0)),
      });
    } catch (e) {
      if (!silent) wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      if (!silent) wx.hideLoading();
    }
  },

  /** 链接提示页右上角叉：关掉当前提示页、直接到首页 */
  onClosePage() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  /** 点收礼礼薄：只进账本主人那本的详情页（带 ownerId，绝不进自己的账） */
  onEventTap(e) {
    const id = e.currentTarget.dataset.id;
    const owner = this.data.ownerId;
    if (!id || !owner) return;
    wx.navigateTo({ url: `/pages/receive-detail/receive-detail?id=${id}&ownerId=${owner}` });
  },

  /** 点送礼行：只进账本主人的送礼页（带 ownerId） */
  onGiftsTap() {
    const owner = this.data.ownerId;
    if (!owner) return;
    wx.navigateTo({ url: `/pages/gifts/gifts?ownerId=${owner}` });
  },
});
