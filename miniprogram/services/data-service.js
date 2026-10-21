/**
 * 礼单簿 · 数据服务层（阶段2 2A）
 *
 * 页面只调这一层，不直接碰 core/ 也不直接碰存储。
 * 开发期用微信本地存储（WxStorageDB）演示；云环境就绪后把 _makeDb()
 * 换成 CloudDB，页面代码不动。本地模式开关见 AppConfig.demo.localMode。
 *
 * 所有业务规则（额度、权限、会员状态）都在 core/ 里实现，这里只做
 * 参数组装与错误转用户可读文案。
 */
const core = require('../core/index.js');
const AppConfig = require('../config/app-config.js');
const { tagIconPath } = require('../config/tag-icons.js');
const { WxStorageDB } = require('./db-wxstorage.js');
const demoSeed = require('./demo-seed.js');

const USER_KEY = 'lidanbu_demo_user';
const SEEDED_KEY = 'lidanbu_demo_seeded_v2';
const OLD_SEEDED_KEY = 'lidanbu_demo_seeded_v1';

let _db = null;
let _userId = null;
let _dbFactory = null; // 仅测试注入用（模拟数据库失败/恢复），生产恒为 null

function _makeDb() {
  // —— 本地/云切换点（只改这里，页面代码不动）——
  // 本地演示模式：return new WxStorageDB();（当前）
  // 云模式：return new core.db.CloudDB();
  //   切云的前提（缺一不可，见 docs/云环境切换步骤.md）：
  //   1) miniprogram/config/app-config.js 的 cloudEnvId 填好环境 ID
  //      （app.js 启动时自动读取并 wx.cloud.init，不用改其他文件）；
  //   2) AppConfig.demo.localMode 设为 false；
  //   3) core/db-cloud.js 骨架已补全并联调通过；
  //   4) cloudfunctions/api 已部署。
  // 注意：WxStorageDB 与 CloudDB 同接口（collection/insert/find/findOne/count/update/remove），
  // core/ 业务层不感知底层是本地还是云，所以切换后页面层零改动。
  return new WxStorageDB();
}

/** 网络类错误识别（云函数调用失败/请求超时等）→ 给大白话网络文案，不透内部信息 */
function isNetworkError(err) {
  if (!err) return false;
  const msg = String((err && (err.errMsg || err.message)) || err);
  return /request:fail|callFunction:fail|timeout|timed out|Network|network|net::|ERR_|socket|连接失败|网络/.test(msg);
}

const NETWORK_HINT = '网络不太顺，请检查网络后再试一次';

function friendly(err) {
  if (!err) return '操作失败，请重试';
  if (isNetworkError(err)) return NETWORK_HINT;
  const msg = err.message || String(err);
  // core 抛出的已是用户可读文案（errors.js），直接透出；兜底未知错误
  // 卖惨文案以"呜呜"开头，也须透出（此前会被吞成"操作失败"，已修复）
  if (/^无权限|需要开通会员|额度|已达上限|不存在|重复|不能为空|必须|邀请|积分|昵称|隐私|请填写|请选择|反馈|注销|呜呜/.test(msg)) return msg;
  return '操作失败，请重试';
}

/** 订单 → 页面展示形状（金额走 formatAmount 两位小数；日期只到天，与全站口径一致） */
const ORDER_STATUS_TEXT = {
  pending: '待支付', paid: '已开通', failed: '支付失败', cancelled: '已取消', refunded: '已退款',
};
function presentOrder(o) {
  if (!o) return null;
  const dstr = (ts) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '');
  return {
    id: o._id,
    kind: o.kind || 'plan',
    kindText: o.kind === 'pointsPack' ? '积分礼包' : '会员套餐',
    planId: o.planId,
    planName: o.planName,
    days: o.days,
    pointsAmount: o.pointsAmount || 0,
    amountText: core.format.formatAmount(o.amountFen),
    status: o.status,
    statusText: ORDER_STATUS_TEXT[o.status] || o.status,
    createdText: dstr(o.createdAt),
    paidText: dstr(o.paidAt),
  };
}

async function ensureUser() {
  const col = _db.collection(core.models.COLLECTIONS.User);
  let user = await col.findOne({ _id: _userId });
  if (!user) {
    _userId = _userId || `demo_${Date.now()}`;
    user = {
      _id: _userId,
      // 资料（任务Q1）：昵称空串=未设置，显示名读取时解析为"微信用户"；
      // 不再写死自称"我"，也不写顶层 nickname 字段
      profile: { nickname: '', avatarUrl: '' },
      createdAt: Date.now(),
      membership: { status: 'free', expireAt: null },
    };
    await col.insert(user);
    try { wx.setStorageSync(USER_KEY, _userId); } catch (e) { /* ignore */ }
    // 新用户注册赠送积分（core/points 幂等：refId 固定，重复初始化只发一次；
    // 赠送失败不拦注册主流程）
    try { await core.points.grantRegisterBonus(_db, _userId, AppConfig); } catch (e) { /* ignore */ }
  }
  return user;
}

/**
 * 清理 v1 演示种子（只有张三/李五两个联系人、无 seed 标记）：
 * 仅当旧标记在、且联系人没有任何收/送礼记录引用时才删，绝不动用户自己的数据。
 */
async function cleanupV1Seeds() {
  let old = false;
  try { old = !!wx.getStorageSync(OLD_SEEDED_KEY); } catch (e) { /* ignore */ }
  if (!old) return;
  const C = core.models.COLLECTIONS;
  const pairs = [['张三', '同学'], ['李五', '邻居']];
  for (const [name, remark] of pairs) {
    const c = await _db.collection(C.Contact).findOne({ ownerId: _userId, name, remark });
    if (!c || c.seed) continue;
    const used = (await _db.collection(C.ReceiveRecord).count({ ownerId: _userId, contactId: c._id }))
      + (await _db.collection(C.GiftRecord).count({ ownerId: _userId, contactId: c._id }));
    if (used === 0) await _db.collection(C.Contact).remove({ _id: c._id, ownerId: _userId });
  }
  try { wx.removeStorageSync(OLD_SEEDED_KEY); } catch (e) { /* ignore */ }
}

/**
 * 演示数据：只在本地演示模式下种、且只种一次（标记 v2）。
 * 内容与 id 防重逻辑在 services/demo-seed.js；种下的数据全带 seed:true 标记。
 */
async function seedDemo() {
  if (!(AppConfig.demo && AppConfig.demo.localMode)) return;
  let seeded = false;
  try { seeded = !!wx.getStorageSync(SEEDED_KEY); } catch (e) { /* ignore */ }
  if (seeded) return;
  try {
    await cleanupV1Seeds();
    await demoSeed.seedDemoData(_db, core, _userId);
  } catch (e) { /* 演示种子失败不阻断启动 */ }
  try { wx.setStorageSync(SEEDED_KEY, true); } catch (e) { /* ignore */ }
}

const DEVICE_KEY = 'lidanbu_device_id';
const PENDING_INVITE_KEY = 'lidanbu_pending_invite_code';

/**
 * 设备指纹占位：本地生成并持久化的随机设备 id（可注入）。
 * ⚠️ 这不是真机设备指纹采集；真机方案（设备信息组合/云端风控）列入
 * docs/开通云开发与联调清单，采集口径确定后只换这里的生成方式。
 */
function getDeviceId() {
  try {
    let d = wx.getStorageSync(DEVICE_KEY);
    if (!d) {
      d = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      wx.setStorageSync(DEVICE_KEY, d);
    }
    return d;
  } catch (e) { return null; }
}

/** 邀请额度入参：成功邀请实数 + 生效设置（失败时按无奖励兜底，不影响记账） */
async function inviteOpts() {
  try {
    const successfulInvites = await core.inviteReward.countSuccessfulInvites(_db, _userId);
    const settings = await core.quota.resolveInviteSettings(_db);
    return { successfulInvites, settings };
  } catch (e) { return {}; }
}

/** 记账后静默评估邀请奖励发放：未达条件只是不发放，绝不打扰记账本身 */
async function evalInviteQuiet() {
  try {
    await core.inviteReward.evaluateInvite(_db, _userId, { deviceId: getDeviceId() });
  } catch (e) { /* 邀请评估失败不影响记账 */ }
}

const service = {
  /**
   * 应用启动时调用一次 —— 静默登录（任务Q1）：
   * 本产品**没有任何"先登录才能进"的拦截页**：打开小程序直接进首页，
   * 身份在后台静默建立，全程不弹登录框、不强制授权头像/昵称/手机号。
   * - 本地演示模式：直接建/取本地用户（ensureUser）。
   * - 云模式（联调时接）：wx.login() 拿 code → 云函数以 code 换 openid
   *   （code2session）→ 以 openid 建/取用户；适配位就在这里，
   *   init 的流程与页面代码都不用改。
   * 失败口径：不抛死，返回 { ok:false, reason:'network' } 并清掉半成品
   * 状态，app.js 把结果存进 globalData.initState，首页据此显示
   * "网络不太顺，点这里重试"，用户点一下就再调一次 init（可重试成功）。
   * 成功返回 { ok:true }。
   */
  async init() {
    if (_db) return { ok: true, already: true };
    try {
      _db = _dbFactory ? _dbFactory() : _makeDb();
      try {
        const saved = wx.getStorageSync(USER_KEY);
        if (saved) _userId = saved;
      } catch (e) { /* ignore */ }
      // 注销冷静期到期执行（本地模式的触发点；云端改定时任务，见 core/account）
      if (_userId) {
        try { await core.account.executeCancellationIfDue(_db, _userId); } catch (e) { /* 忽略 */ }
      }
      await ensureUser();
      await seedDemo();
      return { ok: true };
    } catch (e) {
      _db = null; // 清掉半成品，保证重试能从干净状态重来
      return { ok: false, reason: 'network' };
    }
  },

  get userId() { return _userId; },
  get localMode() { return !!(AppConfig.demo && AppConfig.demo.localMode); },

  // —— 个人资料与隐私同意（任务Q1） ——
  /** 我的资料：{ displayName(显示名,无昵称时"微信用户"), nickname(原始存值), avatarUrl } */
  async getProfile() {
    await ensureUser();
    return core.users.getProfile(_db, _userId);
  },
  /** 改昵称/头像：昵称过长度与内容安全校验（core/users），违规抛委婉文案 */
  async updateProfile(patch) {
    try {
      const user = await core.users.updateProfile(_db, _userId, patch || {}, { config: AppConfig });
      return {
        displayName: core.users.displayName(user),
        nickname: (user.profile && user.profile.nickname) || '',
        avatarUrl: (user.profile && user.profile.avatarUrl) || '',
      };
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 我的隐私同意状态：{ agreed, agreedAt, version, currentVersion } */
  async getPrivacyConsent() {
    await ensureUser();
    return core.users.getPrivacyConsent(_db, _userId, AppConfig);
  },
  /** 记录隐私同意（true=同意当前版本政策 / false=撤回） */
  async setPrivacyConsent(agreed) {
    return core.users.setPrivacyConsent(_db, _userId, agreed, { config: AppConfig });
  },

  // —— 联系人 ——
  async listContacts() {
    return core.contacts.listContacts(_db, _userId, _userId);
  },
  async searchContacts(keyword) {
    return core.contacts.searchContacts(_db, _userId, _userId, keyword);
  },
  async createContact({ name, remark }) {
    try {
      return await core.contacts.createContact(_db, _userId, _userId, { name, remark });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateContact(contactId, { name, remark }) {
    try {
      return await core.contacts.updateContact(_db, _userId, _userId, contactId, { name, remark });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 两步删除：先返回影响条数，确认后再传 confirmed=true 真删 */
  async deleteContact(contactId, confirmed = false) {
    try {
      return await core.contacts.deleteContact(_db, _userId, _userId, contactId, confirmed);
    } catch (e) { throw new Error(friendly(e)); }
  },

  // —— 送礼 ——
  async listGifts() {
    const list = await core.gifts.listGifts(_db, _userId, _userId);
    // 最新在上
    return list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  async createGift({ contactId, tagId, amountFen, remark, date }) {
    try {
      const r = await core.gifts.createGift(_db, _userId, _userId, {
        contactId, tagId, amount: amountFen, remark, date,
      });
      await evalInviteQuiet(); // 送礼记录是邀请奖励的有效动作之一
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateGift(giftId, patch) {
    try {
      return await core.gifts.updateGift(_db, _userId, _userId, giftId, patch);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async deleteGift(giftId) {
    try {
      return await core.gifts.deleteGift(_db, _userId, _userId, giftId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getGift(giftId) {
    const col = _db.collection(core.models.COLLECTIONS.GiftRecord);
    const doc = await col.findOne({ _id: giftId, ownerId: _userId });
    if (!doc) return doc;
    // 补记账人显示名（读取时按作者当前昵称解析，任务Q1）
    const [named] = await core.users.attachCreatorNames(_db, [doc]);
    return named;
  },

  // —— 标签/配置 ——
  getTags() { return AppConfig.tags; },
  getTagById(id) { return AppConfig.tags.find((t) => t.id === id); },
  getDefaultTagId() { return AppConfig.defaultTagId; },
  /** 收礼类型：红包/现金/转账/微信/支付宝 */
  getRecordTypes() { return AppConfig.recordTypes || ['红包', '现金', '转账', '微信', '支付宝']; },
  /** 标签图案：唯一映射，换文件即换图案（见 config/tag-icons.js） */
  tagIcon(tagId) {
    return tagIconPath(tagId);
  },

  // —— 会员/额度 ——
  async getMembership() {
    const col = _db.collection(core.models.COLLECTIONS.User);
    const user = await col.findOne({ _id: _userId });
    return {
      state: core.quota.getMembershipState(user),
      quota: core.quota.getEffectiveQuota(user, AppConfig, Date.now(), await inviteOpts()),
      expireAt: (user.membership && user.membership.expireAt) || null,
    };
  },

  /**
   * 演示专用：切换会员状态（'free' 免费 | 'member' 会员 | 'grace' 会员已到期/缓冲期）。
   * 只改用户文档的 membership 一个字段，之后的状态与额度全部走 core/quota
   * 现行计算（getMembershipState/getEffectiveQuota），没有第二套假逻辑。
   * 仅本地演示模式可用；返回切换后的状态。
   */
  async setDemoMembership(mode) {
    if (!this.localMode) throw new Error('演示切换只在本地演示模式可用');
    if (!['free', 'member', 'grace'].includes(mode)) throw new Error('演示状态只能是 免费/会员/会员已到期');
    try {
      return await demoSeed.applyDemoMembership(_db, core, _userId, mode);
    } catch (e) { throw new Error(friendly(e)); }
  },

  /** 额度使用情况：各类已用/上限（免费+会员+邀请奖励） */
  async getQuotaUsage() {    const me = await ensureUser();
    const quota = core.quota.getEffectiveQuota(me, AppConfig, Date.now(), await inviteOpts());
    const events = await _db.collection(core.models.COLLECTIONS.ReceiveEvent).find({ ownerId: _userId });
    const gifts = await _db.collection(core.models.COLLECTIONS.GiftRecord).count({ ownerId: _userId });
    const contacts = await _db.collection(core.models.COLLECTIONS.Contact).count({ ownerId: _userId });
    const receivePool = await core.quota.computePoolUsed(_db, _userId, quota.recordsPerEvent);
    return {
      state: core.quota.getMembershipState(me),
      quota,
      used: { events: events.length, receivePool, gifts, contacts },
    };
  },

  /** 会员到期三次提醒：到期前15天 / 到期当天 / 缓冲期结束前 */
  getReminderInfo() {
    return _db.collection(core.models.COLLECTIONS.User).findOne({ _id: _userId }).then((user) => {
      const times = core.quota.getReminderSchedule(user || {});
      const labels = ['到期前 15 天', '到期当天', '缓冲期结束前'];
      const nowT = Date.now();
      return times.map((t, i) => ({ label: labels[i], at: t, passed: nowT >= t, date: new Date(t).toLocaleDateString('zh-CN') }));
    });
  },

  // —— 支付与会员订单（任务K：适配层 + 模拟支付） ——
  /** 生效价格档位：老板平台配置优先、否则静态占位价；金额已格式化，页面不写死价格 */
  async getPricing() {
    const plans = await core.payment.resolvePricing(_db);
    return plans.map((p) => ({ ...p, priceText: core.format.formatAmount(p.priceFen) }));
  },

  /**
   * 购买会员：本地演示走 Mock 模拟支付（默认成功，走与真实通道相同的
   * 建单→调起→回调发货链路）；真实环境换 WechatVirtualPayAdapter，
   * 本方法与页面均不改（见 core/pay-adapter.js、docs/T0.3）。
   */
  async purchaseMembership(planId) {
    try {
      const adapter = new core.payAdapter.MockPayAdapter({ result: 'success' });
      const r = await core.payment.purchase(_db, _userId, planId, { adapter });
      return { delivered: r.delivered, order: presentOrder(r.order) };
    } catch (e) {
      if (e && e.code === 'plan-not-found') throw new Error('这个会员档位已经下架啦，看看其他档位吧');
      throw new Error(friendly(e));
    }
  },

  /** 我的订单（最新在上，金额两位小数） */
  async listMyOrders() {
    const list = await core.payment.listOrders(_db, _userId);
    return list.map(presentOrder);
  },

  // —— 积分账户（任务P2：余额/流水/礼包购买/购买页聚合） ——
  /** 当前积分余额（积分不过期，会员到期后保留） */
  async getPointsBalance() {
    try {
      return await core.points.getBalance(_db, _userId);
    } catch (e) { throw new Error(friendly(e)); }
  },

  /** 我的积分流水（最新在上）：来源/消耗文案 + ±数 + 时间 + 关联订单号，可对账 */
  async getPointsLedger() {
    const KIND_TEXT = {
      register_grant: '注册赠送',
      plan_grant: '购买套餐赠送',
      plan_grant_reversal: '订单退款回收',
      pack_purchase: '购买积分礼包',
      pack_purchase_reversal: '积分礼包退款回收',
      photo_import: '拍照录入',
      photo_refund: '识别失败返还',
      manual: '其他调整',
    };
    try {
      const list = await core.points.listLedger(_db, _userId, { limit: 100 });
      const pad = (n) => String(n).padStart(2, '0');
      const timeText = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      return list.map((e) => ({
        id: e._id,
        delta: e.delta,
        deltaText: (e.delta > 0 ? '+' : '') + e.delta,
        kind: e.kind,
        kindText: KIND_TEXT[e.kind] || '积分变动',
        note: e.note || '',
        refId: e.refId || '',
        balanceAfter: e.balanceAfter,
        createdText: timeText(e.createdAt),
      }));
    } catch (e) { throw new Error(friendly(e)); }
  },

  /** 生效积分规则（数字全部读配置：注册赠送/拍照单价/礼包档位，礼包金额已格式化） */
  async getPointsSettings() {
    const s = await core.points.resolvePointsSettings(_db);
    return {
      registerGrant: s.registerGrant,
      photoImportCost: s.photoImportCost,
      packs: (s.packs || []).map((p) => ({ ...p, priceText: core.format.formatAmount(p.priceFen) })),
    };
  },

  /**
   * 购买积分礼包：仅会员可买（core 下单层校验，非会员不产生订单）。
   * 本地演示走 Mock 模拟支付，链路与套餐购买同构。
   */
  async purchasePointsPack(packId) {
    try {
      const adapter = new core.payAdapter.MockPayAdapter({ result: 'success' });
      const r = await core.payment.purchasePointsPack(_db, _userId, packId, { adapter });
      return { delivered: r.delivered, order: presentOrder(r.order) };
    } catch (e) {
      if (e && (e.code === 'points-pack-member-only' || e.code === 'points-pack-not-found')) {
        throw new Error(e.message);
      }
      throw new Error(friendly(e));
    }
  },

  /**
   * 购买页聚合数据（任务P2）：会员状态 + 积分余额 + 套餐 + 礼包 +
   * 本终端购买开关。平台开关的生效值 = 静态配置 ← 老板平台
   * appConfig 文档 paymentPlatforms 覆盖，合并后交 core 的纯函数判定，
   * 页面只读结果、不写死任何平台判断。
   * @param {string} platform 设备平台（wx.getDeviceInfo().platform，如 'ios'/'android'）
   */
  async getPurchasePageData(platform) {
    const membership = await this.getMembership();
    const pointsBalance = await this.getPointsBalance();
    const plans = await this.getPricing();
    const settings = await this.getPointsSettings();
    let platformOverrides = null;
    try {
      const doc = await _db.collection(core.models.COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
      platformOverrides = doc && doc.paymentPlatforms;
    } catch (e) { /* 读不到覆盖就用静态配置 */ }
    const mergedConfig = {
      ...AppConfig,
      payment: {
        ...(AppConfig.payment || {}),
        platforms: { ...((AppConfig.payment || {}).platforms || {}), ...(platformOverrides || {}) },
      },
    };
    return {
      state: membership.state,
      expireAt: membership.expireAt,
      pointsBalance,
      plans,
      packs: settings.packs,
      photoImportCost: settings.photoImportCost,
      purchaseEnabled: core.payment.resolvePlatformPurchaseEnabled(mergedConfig, platform),
      platformDisabledTip: (AppConfig.payment && AppConfig.payment.platformDisabledTip) || '',
    };
  },

  // —— 家庭共享（阶段3） ——
  /** 发起邀请：{ switches, scope:{events:[], gifts} }；会员专属 */
  async shareInvite({ switches, scope }) {
    try {
      return await core.share.invite(_db, _userId, { switches, scope });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 我发出的成员列表（含权限摘要） */
  async listMembers() {
    try {
      const list = await core.share.listMembers(_db, _userId);
      // 补成员昵称（本地演示：memberId 为空=待接受）
      return list;
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 某成员的权限详情 */
  async getGrant(membershipId) {
    try {
      return await _db.collection(core.models.COLLECTIONS.ShareGrant).findOne({ membershipId });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 修改成员权限（立即生效） */
  async updateGrant(membershipId, { switches, scope }) {
    try {
      return await core.share.updateGrant(_db, _userId, membershipId, { switches, scope });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 移除成员（记录保留） */
  async removeMember(membershipId) {
    try {
      return await core.share.removeMember(_db, _userId, membershipId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 我收到的共享（我是成员的账本） */
  async myReceivedShares() {
    try {
      const mss = await _db.collection(core.models.COLLECTIONS.ShareMembership)
        .find({ memberId: _userId, status: 'active' });
      const out = [];
      for (const ms of mss) {
        const owner = await _db.collection(core.models.COLLECTIONS.User).findOne({ _id: ms.ownerId });
        // 账本主人显示名走统一解析（任务Q1）：其当前昵称，无昵称显示"微信用户"；
        // 主人文档已不存在（已注销）时才兜底叫"家人"
        out.push({ membershipId: ms._id, ownerId: ms.ownerId, ownerName: owner ? core.users.displayName(owner) : '家人', createdAt: ms.createdAt });
      }
      return out;
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 接受邀请 */
  async acceptShare(membershipId) {
    try {
      return await core.share.accept(_db, membershipId, _userId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 家人视角：已授权给我的礼薄列表（只含授权事件） */
  async listMemberEvents(ownerId) {
    try {
      return await core.stats.memberEvents(_db, _userId, ownerId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 共享开关清单（供邀请页渲染） */
  getShareSwitches() { return AppConfig.shareSwitches; },
  /** 当前账本数据情况（导出页概览） */
  async exportSummary() {
    const C = core.models.COLLECTIONS;
    const events = await _db.collection(C.ReceiveEvent).find({ ownerId: _userId });
    const receiveRecords = await _db.collection(C.ReceiveRecord).count({ ownerId: _userId });
    const gifts = await _db.collection(C.GiftRecord).count({ ownerId: _userId });
    const contacts = await _db.collection(C.Contact).count({ ownerId: _userId });
    return { events, receiveRecords, gifts, contacts };
  },
  /**
   * 导出 xlsx：经云函数生成真文件。
   * 本地模式下 exceljs 不可用，直接提示云联调后可用。
   */
  async exportXlsx({ eventIds = null, includeGifts = true } = {}) {
    if (AppConfig.demo.localMode) {
      throw new Error('导出功能需要云环境，云联调后可用');
    }
    const res = await wx.cloud.callFunction({
      name: 'api',
      data: { action: 'exportXlsx', eventIds, includeGifts },
    });
    return res.result;
  },
  /** 写导出历史 */
  async logExportJob(scope) {
    await _db.collection(core.models.COLLECTIONS.ExportJob).insert({
      ownerId: _userId, scope: scope || '', status: 'done', createdAt: Date.now(),
    });
  },
  /** 导出历史记录 */
  async listExportJobs() {
    return _db.collection(core.models.COLLECTIONS.ExportJob)
      .find({ ownerId: _userId }, { sort: { createdAt: -1 }, limit: 50 });
  },
  // —— 账号注销全流程（任务L；⚠️ 开关关闭时申请被拒，确认前不上线） ——
  /** 提交注销申请（进入冷静期）；开关未开放时抛"暂未开放" */
  async applyCancellation() {
    try {
      return await core.account.requestCancellation(_db, _userId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 撤销注销（冷静期内） */
  async revokeCancellation() {
    try {
      return await core.account.revokeCancellation(_db, _userId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 注销状态：{status, cancelAt, remainingDays, enabled}（"我的"页待注销提示用） */
  async getCancellationStatus() {
    return core.account.getCancellationStatus(_db, _userId);
  },

  // —— 通知中心（任务L） ——
  /** 顺带触发一次会员三提醒判定（到点才发、去重，见 core/notify） */
  async _refreshReminders() {
    try { await core.notify.checkMembershipReminders(_db, _userId); } catch (e) { /* 忽略 */ }
  },
  /** 我的通知列表（最新在上，含已读标记） */
  async listNotifications() {
    await this._refreshReminders();
    return core.notify.listNotifications(_db, _userId);
  },
  /** 未读通知数（"我的"页红点）；页面打开时顺带判定会员提醒 */
  async getUnreadCount() {
    await this._refreshReminders();
    return core.notify.unreadCount(_db, _userId);
  },
  /** 标一条已读（只能标自己的） */
  async markNotificationRead(notificationId) {
    return core.notify.markRead(_db, _userId, notificationId);
  },
  /** 全部标已读 */
  async markAllNotificationsRead() {
    return core.notify.markAllRead(_db, _userId);
  },

  // —— 意见反馈（任务L） ——
  /** 提交反馈：文字必填、截图可选（本轮存占位，云联调后由页面先上传再传 fileID） */
  async submitFeedback({ content, images } = {}) {
    try {
      return await core.feedback.submitFeedback(_db, _userId, { content, images });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 我提交过的反馈 */
  async listMyFeedback() {
    return core.feedback.listMyFeedback(_db, _userId);
  },

  // —— 拍照导入（阶段4；OCR 厂商未拍板，本轮只走 MockOCR） ——
  /**
   * 开始拍照导入任务 → { jobId, items, cost }
   * core 任务流顺序：会员门禁 → 积分预检 → 识别 → 识别成功后扣积分。
   * 抛错带 code：'member-required'（非会员）/ 'insufficient-points'（积分不足，
   * 识别前拦截、未扣款），页面据此弹不同引导；识别失败为普通错误（未扣款）。
   * opts.jobId 复用同一任务时传入（重试不重复扣费）；opts.eventId 收礼必传。
   */
  async recognizePhoto(imagePath, kind, opts = {}) {
    try {
      const r = await core.importer.startImportTask(_db, _userId, _userId, {
        jobId: opts.jobId || '',
        kind,
        eventId: opts.eventId || '',
        imagePath,
        provider: opts.provider,
        fail: opts.fail,
      });
      return { jobId: r.jobId, items: r.items, cost: r.cost };
    } catch (e) {
      const err = new Error(friendly(e));
      if (e && e.code) err.code = e.code;
      throw err;
    }
  },
  // —— 收礼礼薄（事件）——
  /** 收礼礼薄列表（导入前先选） */
  async listEvents() {
    return core.receive.listEvents(_db, _userId, _userId);
  },
  async createEvent({ name, tagId, date, remark }) {
    try {
      return await core.receive.createEvent(_db, _userId, _userId, { name, tagId, date, remark });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateEvent(eventId, patch) {
    try {
      return await core.receive.updateEvent(_db, _userId, _userId, eventId, patch);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 删除礼薄：返回 {removedRecords}（连带删除的明细条数），供弹窗展示 */
  async deleteEvent(eventId) {
    try {
      return await core.receive.deleteEvent(_db, _userId, _userId, eventId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getEvent(eventId) {
    const col = _db.collection(core.models.COLLECTIONS.ReceiveEvent);
    return col.findOne({ _id: eventId, ownerId: _userId });
  },
  /** 礼薄共计：{count, totalFen} */
  async getEventStats(eventId) {
    const recs = await core.receive.listRecords(_db, _userId, _userId, eventId);
    const totalFen = recs.reduce((s, r) => s + (r.amount || 0), 0);
    return { count: recs.length, totalFen };
  },

  // —— 收礼明细记录 ——
  async listRecords(eventId) {
    try {
      return await core.receive.listRecords(_db, _userId, _userId, eventId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async createRecord(eventId, { contactId, amountFen, type, remark, date }) {
    try {
      const r = await core.receive.createRecord(_db, _userId, _userId, eventId, {
        contactId, amount: amountFen, type, remark, date,
      });
      await evalInviteQuiet(); // 收礼记录是邀请奖励的有效动作之一
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateRecord(recordId, patch) {
    try {
      return await core.receive.updateRecord(_db, _userId, _userId, recordId, patch);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async deleteRecord(recordId) {
    try {
      return await core.receive.deleteRecord(_db, _userId, _userId, recordId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getRecord(recordId) {
    const col = _db.collection(core.models.COLLECTIONS.ReceiveRecord);
    const doc = await col.findOne({ _id: recordId, ownerId: _userId });
    if (!doc) return doc;
    // 补记账人显示名（读取时按作者当前昵称解析，任务Q1）
    const [named] = await core.users.attachCreatorNames(_db, [doc]);
    return named;
  },

  // —— 往来 ——
  /**
   * 往来列表：每位亲友一行 {contactId, name, count, receiveFen, giftFen, diffFen}
   * @param {string} [ownerId] 缺省看自己账本；传他人 id 则为成员视角（只算授权部分）
   * @param {string|{start,end}} [range] 时间范围，缺省近一年
   * @returns {rows, totalReceiveFen, totalGiftFen, totalReceiveCount, totalGiftCount,
   *           diffFen, from, to, isMember}
   */
  async getWanglaiList({ ownerId, range } = {}) {
    const oid = ownerId || _userId;
    const isMember = oid !== _userId;
    try {
      const rg = core.stats.resolveRangeOpt(range);
      const contacts = await core.contacts.listContacts(_db, _userId, oid);
      const rows = [];
      let totalReceiveFen = 0, totalGiftFen = 0, totalReceiveCount = 0, totalGiftCount = 0;
      for (const c of contacts) {
        const st = isMember
          ? await core.stats.memberStats(_db, _userId, oid, c._id, { range })
          : await core.stats.contactStats(_db, oid, c._id, { range });
        const count = st.receiveCount + st.giftCount;
        if (count === 0) continue;
        totalReceiveFen += st.receiveTotalFen;
        totalGiftFen += st.giftTotalFen;
        totalReceiveCount += st.receiveCount;
        totalGiftCount += st.giftCount;
        rows.push({
          contactId: c._id, name: c.name, remark: c.remark || '',
          count, receiveFen: st.receiveTotalFen, giftFen: st.giftTotalFen,
          diffFen: st.diffFen,
        });
      }
      // 按往来笔数倒序，笔数相同按姓名
      rows.sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
      return {
        rows, totalReceiveFen, totalGiftFen, totalReceiveCount, totalGiftCount,
        diffFen: totalReceiveFen - totalGiftFen,
        from: rg.from, to: rg.to, isMember,
      };
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 往来页搜索：输入姓名出联系人（成员视角自动只搜可见的） */
  async searchWanglaiContacts({ ownerId, keyword } = {}) {
    const oid = ownerId || _userId;
    try {
      return await core.contacts.searchContacts(_db, _userId, oid, keyword || '');
    } catch (e) { throw new Error(friendly(e)); }
  },
  /**
   * 竖线树数据（成员视角自动过滤未授权记录）
   * @returns {items, receiveTotalFen, receiveCount, giftTotalFen, giftCount, diffFen, isMember}
   */
  async getTimeline({ contactId, ownerId, range } = {}) {
    const oid = ownerId || _userId;
    try {
      const tl = await core.stats.memberTimeline(_db, _userId, oid, contactId, { range });
      const c = await this.getContact(contactId, oid);
      return { ...tl, contactName: c ? c.name : '' };
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getContact(contactId, ownerId) {
    const oid = ownerId || _userId;
    const col = _db.collection(core.models.COLLECTIONS.Contact);
    return col.findOne({ _id: contactId, ownerId: oid });
  },
  /**
   * 确认写入识别结果；core 整批原子校验：任一条不合格整批不写。
   * 成功返回 { written, total }；失败抛错（err.written/err.total 为已写入/总数，
   * err.itemIndex 为出问题那条的下标，页面据此高亮定位），
   * 额度类错误消息为卖惨文案，直接展示。
   */
  async importWrite({ kind, eventId, items, jobId }) {
    const r = await core.importer.writeImport(_db, _userId, _userId, { kind, eventId, items, jobId });
    if (r.rawError) {
      const err = new Error(friendly(r.rawError));
      err.written = r.written;
      err.total = r.total;
      if (r.rawError.code) err.code = r.rawError.code;
      if (Number.isInteger(r.rawError.itemIndex)) err.itemIndex = r.rawError.itemIndex;
      throw err;
    }
    return { written: r.written, total: r.total };
  },

  // —— 横置礼单本（阶段4）：按账本主人读数据（自己或成员视角，core 每次都校验授权） ——
  /** 礼薄列表：ownerId 缺省=自己；成员视角只返回已授权事件 */
  async listEventsFor(ownerId) {
    const oid = ownerId || _userId;
    try {
      return oid === _userId
        ? await core.receive.listEvents(_db, _userId, oid)
        : await core.stats.memberEvents(_db, _userId, oid);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 某礼薄的收礼记录：成员视角由 core.receive.listRecords 内部 authz 校验范围 */
  async listRecordsFor(ownerId, eventId) {
    const oid = ownerId || _userId;
    try {
      return await core.receive.listRecords(_db, _userId, oid, eventId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 送礼记录：ownerId 缺省=自己；成员视角由 core authz 校验（含 scope.gifts） */
  async listGiftsFor(ownerId) {
    const oid = ownerId || _userId;
    try {
      const list = await core.gifts.listGifts(_db, _userId, oid);
      return list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (e) { throw new Error(friendly(e)); }
  },
  /**
   * 我作为成员对某账本的授权（横置页按钮显隐用）：
   * 自己账本返回 null（页面按 owner 处理）；成员返回 { switches, scope }，无有效共享返回 null。
   */
  async getGrantFor(ownerId) {
    if (!ownerId || ownerId === _userId) return null;
    const ms = await _db.collection(core.models.COLLECTIONS.ShareMembership)
      .findOne({ ownerId, memberId: _userId, status: 'active' });
    if (!ms) return null;
    const grant = await _db.collection(core.models.COLLECTIONS.ShareGrant)
      .findOne({ membershipId: ms._id });
    if (!grant) return null;
    return { switches: grant.switches || {}, scope: grant.scope || {} };
  },

  friendly,

  // —— 邀请奖励（邀请得名额）——
  /** 本机设备指纹占位 id（真机采集见联调清单） */
  getDeviceId,
  /** 我的邀请奖励汇总：先静默评估一次发放，再返回汇总（奖励额度/成功数/上限/记录） */
  async getInviteSummary() {
    try {
      await evalInviteQuiet();
      return await core.inviteReward.getMyInviteSummary(_db, _userId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 手动输入邀请码绑定（与分享卡片带码等效，不要求分享到任何地方） */
  async bindInviteCode(code) {
    try {
      return await core.inviteReward.bindInvite(_db, _userId, { code, deviceId: getDeviceId() });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** app 启动捕获到的待绑定邀请码先存起来，init 后调 bindPendingInvite */
  setPendingInviteCode(code) {
    try { if (code) wx.setStorageSync(PENDING_INVITE_KEY, String(code)); } catch (e) { /* ignore */ }
  },
  /**
   * 绑定启动时捕获的邀请码：静默执行。
   * 绑定成功、或明确不可绑定（码无效/已绑定/非新用户/活动未开启）后清除，
   * 避免每次启动重复尝试；其余失败保留待下次启动再试。
   */
  async bindPendingInvite() {
    let code = null;
    try { code = wx.getStorageSync(PENDING_INVITE_KEY); } catch (e) { /* ignore */ }
    if (!code) return;
    try {
      await core.inviteReward.bindInvite(_db, _userId, { code, deviceId: getDeviceId() });
      try { wx.removeStorageSync(PENDING_INVITE_KEY); } catch (e) { /* ignore */ }
    } catch (e) {
      if (e && typeof e.code === 'string' && e.code.startsWith('invite-')) {
        try { wx.removeStorageSync(PENDING_INVITE_KEY); } catch (e2) { /* ignore */ }
      }
    }
  },

  // —— 老板平台（阶段5）——
  // 铁律：只调 core.admin 白名单聚合接口；绝不返回用户的礼金、联系人、备注内容，
  // 也不能替用户导出账本。所有返回对象只含白名单字段，userId 一律脱敏短号。
  async adminOverview() {
    return core.admin.overview(_db);
  },
  async adminMemberList({ page, pageSize, memberState } = {}) {
    try {
      return await core.admin.memberList(_db, { page, pageSize, memberState });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async adminSetMemberPlan(maskedUserId, plan, days) {
    try {
      return await core.admin.setMemberPlan(_db, maskedUserId, plan, days, 'admin:' + _userId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async adminQuotaUsage(maskedUserId) {
    try {
      return await core.admin.quotaUsage(_db, maskedUserId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async adminInviteStats() {
    return core.admin.inviteStats(_db);
  },
  async adminShareOverview({ limit } = {}) {
    return core.admin.shareOverview(_db, { limit });
  },
  // —— 老板平台补全（任务M）：以下接口 core 侧一律校验管理员身份
  // （只认 appConfig 文档 adminIds；本地演示需先把演示用户写进名单）——
  async adminSearchAccounts(opts = {}) {
    try { return await core.admin.searchAccounts(_db, _userId, opts); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminImportUsage(opts = {}) {
    try { return await core.admin.importUsage(_db, _userId, opts); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminFeedbackList(opts = {}) {
    try { return await core.admin.feedbackList(_db, _userId, opts); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminFeedbackSetStatus(feedbackId, status) {
    try { return await core.admin.feedbackSetStatus(_db, _userId, feedbackId, status); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminOrderList(opts = {}) {
    try { return await core.admin.orderList(_db, _userId, opts); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminOrderStats() {
    try { return await core.admin.orderStats(_db, _userId); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminListAdmins() {
    try { return await core.admin.listAdmins(_db, _userId); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminAuditTrail(opts = {}) {
    try { return await core.admin.auditTrail(_db, _userId, opts); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminSetUserRestricted(maskedUserId, input) {
    try { return await core.admin.setUserRestricted(_db, _userId, maskedUserId, input); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminGetConfig() {
    try { return await core.admin.getConfig(_db, _userId); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdatePricing(plans) {
    try { return await core.admin.updatePricing(_db, _userId, plans); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdateFeatureSwitches(features) {
    try { return await core.admin.updateFeatureSwitches(_db, _userId, features); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdateMemberOnlyFeatures(features) {
    try { return await core.admin.updateMemberOnlyFeatures(_db, _userId, features); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdateQuotaSettings(patch) {
    try { return await core.admin.updateQuotaSettings(_db, _userId, patch); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdateInviteSettings(patch) {
    try { return await core.admin.updateInviteSettings(_db, _userId, patch); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdatePointsSettings(patch) {
    try { return await core.admin.updatePointsSettings(_db, _userId, patch); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdatePaymentPlatforms(platforms) {
    try { return await core.admin.updatePaymentPlatforms(_db, _userId, platforms); }
    catch (e) { throw new Error(friendly(e)); }
  },

  // —— 电子请柬（2026-10-21 用户决定：取消自制请柬，改为跳转外部小程序） ——
  /** 外部请柬小程序配置 { miniprogramName, appId }（app-config.externalInvitation；
   * appId 为空表示尚未配置，首页入口点按提示「敬请期待」） */
  getExternalInvitation() {
    return AppConfig.externalInvitation || { miniprogramName: '', appId: '' };
  },
};

// 供测试与 app.js 网络提示复用（不属于页面接口）
service._isNetworkError = isNetworkError;
service.NETWORK_HINT = NETWORK_HINT;
// 仅测试用：注入 db 工厂（模拟初始化失败/恢复）与复位单例状态
service._setDbFactoryForTest = (fn) => { _dbFactory = fn || null; };
service._resetForTest = () => { _db = null; _userId = null; _dbFactory = null; };

module.exports = service;
