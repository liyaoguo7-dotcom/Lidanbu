/**
 * 礼单簿 · 数据服务层（阶段2 2A）
 *
 * 页面只调这一层，不直接碰 core/ 也不直接碰存储。
 * 本地模式开关见 AppConfig.demo.localMode：
 * - 本地演示（localMode=true）：本地 core + 微信本地存储（WxStorageDB）；
 * - 云模式（localMode=false，任务AD 已落地）：core 绑定换成远程代理
 *   （services/remote-core.js），全部读写经 wx.cloud.callFunction 走
 *   云函数 api，服务端用同一套 core 执行业务；页面代码不动。
 *
 * 所有业务规则（额度、权限、会员状态）都在 core/ 里实现，这里只做
 * 参数组装与错误转用户可读文案。
 */
const coreLib = require('../core/index.js');
const { createRemoteCore } = require('./remote-core.js');
const AppConfig = require('../config/app-config.js');
const { tagIconPath } = require('../config/tag-icons.js');
const { WxStorageDB } = require('./db-wxstorage.js');
const demoSeed = require('./demo-seed.js');

// —— 本地/云切换点 ——
// core 绑定按模式切换：本地 = coreLib；云 = remote-core 代理。
// 全文件业务调用点仍写 core.<模块>.<函数>(_db, _userId, ...)，签名不变；
// models/format/纯函数在 remote-core 里挂的仍是本地实现，绝不走 RPC。
let core = coreLib;

const USER_KEY = 'lidanbu_demo_user';
const SEEDED_KEY = 'lidanbu_demo_seeded_v2';
const OLD_SEEDED_KEY = 'lidanbu_demo_seeded_v1';

let _db = null;
let _userId = null;
let _dbFactory = null; // 仅测试注入用（模拟数据库失败/恢复），生产恒为 null
let _homeDataInflight = null; // 首页数据在途去重：小结与最近往来同时要同一份全量数据时只取一趟
// 列表会话缓存（2026-10-24 提速：保存后/切页回来列表还要等一趟云端才显示）。
// 只缓存本人三张列表与礼薄详情；写入走 write-through（新增直接进缓存、
// 改删精确同步或整表作废），保证缓存与云端一致，不拿旧数据糊弄。
let _listCache = { contacts: null, gifts: null, eventsStats: null };
let _listCacheOwner = null; // 列表缓存归属用户：换号后旧缓存不得 serving（2026-10-31，见下）
const _wanglaiCache = new Map(); // 本人往来列表按范围缓存；任一记录/联系人变更即整表作废
const _timelineCache = new Map(); // 本人往来明细（竖线树）按联系人缓存；与往来列表同批作废（AH批：真机点开联系人第一下 2 秒多、在途去重+缓存后第二下起秒开）
function _dirtyWanglai() { _wanglaiCache.clear(); _timelineCache.clear(); }
const _eventDetailCache = new Map();
function _dirtyLists(...names) { names.forEach((n) => { _listCache[n] = null; }); }
// 2026-10-31 缓存污染修复（DR批修正：首版“空结果绝不进缓存”过宽，撞上
// 2026-10-24 写穿缓存契约——回环测试要求二次读 0 往返。根因不在合法空列表，
// 而在未登录时查回的空被无归属缓存：未登录路径已提前 return [] 不查不缓存，
// 故已登录用户的空列表可缓存，但必须带归属；换号、未登录一律不得 serving。
// 写穿路径只走 data-service 的新增/修改/删除，空缓存 [] 为真值，写穿可正常追加。）
function _cacheList(name, list) {
  if (!_userId) return list;
  if (Array.isArray(list)) { _listCache[name] = list; _listCacheOwner = _userId; }
  return list;
}
let _modeForTest = null; // 仅测试注入用：'local' | 'cloud' | null
let _transportForTest = null; // 仅测试注入用：远程传输（进程内回环到 api 云函数）
let _uploaderForTest = null; // 仅测试注入用：云存储上传（AR批，进程内假实现）
let _deleterForTest = null; // 仅测试注入用：云存储删除（AR批，进程内假实现）

/**
 * 默认云存储上传（AR批）：走 app.js 已 init 的 wx.cloud——与 remote-core
 * 的 callFunction 同一个云实例，不另造传输层。返回 fileID（cloud://…）。
 * 云不可用时抛带 errMsg 的错误，与 defaultTransport 的失败口径一致。
 */
async function defaultUploader(cloudPath, filePath) {
  const cloud = (typeof wx !== 'undefined') ? wx.cloud : null;
  if (!cloud || typeof cloud.uploadFile !== 'function') {
    const e = new Error('uploadFile:fail 云服务不可用');
    e.errMsg = 'uploadFile:fail cloud not ready';
    throw e;
  }
  const res = await cloud.uploadFile({ cloudPath, filePath });
  const fileID = res && res.fileID;
  if (!fileID) throw new Error('uploadFile:fail 未返回 fileID');
  return fileID;
}

/** 默认云存储删除（AR批）：同上，走 wx.cloud.deleteFile */
async function defaultDeleter(fileList) {
  const cloud = (typeof wx !== 'undefined') ? wx.cloud : null;
  if (!cloud || typeof cloud.deleteFile !== 'function') {
    const e = new Error('deleteFile:fail 云服务不可用');
    e.errMsg = 'deleteFile:fail cloud not ready';
    throw e;
  }
  await cloud.deleteFile({ fileList });
}

/** OCR 导入照片的云存储路径：ocr-imports/ 前缀 + 时间戳 + 随机段 + 序号（同批多张不撞名、保序可辨） */
function _ocrCloudPath(localPath, index) {
  const m = /\.(jpe?g|png|webp|gif)$/i.exec(String(localPath || ''));
  const ext = m ? `.${m[1].toLowerCase()}` : '.jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  return `ocr-imports/${Date.now()}-${rand}-${index}${ext}`;
}
let _remoteCore = null;
let _cloudUserReady = false; // 云模式：服务端静默建号是否已触发

/** 当前是否云模式：测试注入优先；注入了本地 db 工厂即本地模式（该注入口本就是本地测试缝） */
function _isCloud() {
  if (_modeForTest) return _modeForTest === 'cloud';
  if (_dbFactory) return false;
  return !(AppConfig.demo && AppConfig.demo.localMode);
}

/** 按当前模式同步 core 绑定（init 与 ensureUser 入口调用，幂等） */
function _syncCoreBinding() {
  if (_isCloud()) {
    if (!_remoteCore) _remoteCore = createRemoteCore(_transportForTest || undefined);
    core = _remoteCore;
  } else {
    core = coreLib;
  }
}

function _makeDb() {
  // 本地演示模式的数据库（微信本地存储）。云模式不使用本地 db
  // （_db 仅作"已初始化"标记），数据全部走远程 core。
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
  // 带机器错误码的错误（core/errors.js 构造）其文案即设计给用户看的，原样透出
  // （任务AE：此前靠逐个调用点特判 code，漏判的就被吞成"操作失败"——
  // 如 user-restricted「该账号已被限制…」；与云函数分发的透传口径一致）
  if (typeof err.code === 'string' && err.code && msg) return msg;
  // core 抛出的已是用户可读文案（errors.js），直接透出；兜底未知错误
  // 卖惨文案以"呜呜"开头，也须透出（此前会被吞成"操作失败"，已修复）
  if (/^无权限|需要开通会员|额度|已达上限|不存在|重复|不能为空|必须|邀请|积分|昵称|隐私|请填写|请选择|反馈|注销|呜呜/.test(msg)) return msg;
  return '操作失败，请重试';
}

/** 订单 → 页面展示形状（金额走 formatAmount 两位小数；日期只到天，与全站口径一致） */
const ORDER_STATUS_TEXT = {
  pending: '待支付', paid: '已开通', failed: '支付失败', cancelled: '已取消', refunded: '已退款',
};
/** 分平台显示价（纯函数）：优先用本地 core 的 platformPriceFen（与服务端同口径），
 * 拿不到时跟现价 priceFen；页面与服务端显示一致，用户只看到自己平台的价。 */
function platformPriceFenOf(item, platform) {
  try {
    if (coreLib && coreLib.payAdapter && typeof coreLib.payAdapter.platformPriceFen === 'function') {
      return coreLib.payAdapter.platformPriceFen(item, platform);
    }
  } catch (e) { /* 兜底跟现价 */ }
  return item.priceFen;
}

function presentOrder(o) {
  if (!o) return null;
  const dstr = (ts) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '');
  return {
    id: o._id,
    kind: o.kind || 'plan',
    kindText: o.kind === 'pointsPack' ? '积分礼包' : '会员套餐',
    planId: o.planId,
    planName: o.planName,
    outTradeNo: o.outTradeNo || '',
    days: o.days,
    pointsAmount: o.pointsAmount || 0,
    amountText: core.format.formatAmount(o.amountFen),
    status: o.status,
    mock: o.mock === true,
    statusText: ORDER_STATUS_TEXT[o.status] || o.status,
    createdText: dstr(o.createdAt),
    paidText: dstr(o.paidAt),
  };
}

/**
 * 确保当前用户存在并返回其文档。
 * - 本地模式：查本地库，没有就建（演示 id）并发注册赠分，见 ensureLocalUser。
 * - 云模式：身份是服务端 openid（init 已由 whoami 取得）；服务端在首次
 *   业务调用时静默建号并发注册赠分（api 分发 ensureServerUser），这里调
 *   一次 getProfile 触发它，之后返回服务端文档（getSelf）。
 */
async function ensureUser() {
  _syncCoreBinding();
  if (_isCloud()) {
    if (!_cloudUserReady) {
      await core.users.getProfile(_db, _userId);
      _cloudUserReady = true;
    }
    return core.users.getSelf(_db, _userId);
  }
  return ensureLocalUser();
}

async function ensureLocalUser() {
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

/**
 * 演示专用：把当前演示用户加进老板平台管理员名单（appConfig singleton
 * 文档的 adminIds），让开发者工具本地预览时能直接打开老板平台各页。
 * —— 仅本地演示模式（localMode=true）下执行；云模式/正式路径下本函数
 * 直接返回，一行名单都不写：正式环境的管理员名单由 init 脚本/后台
 * 维护（见 cloudfunctions/init 与 docs/云联调准备.md），没有名单时
 * core/admin 一律 fail closed 拒绝，本段不改变那个口径。
 * 合并口径：文档不存在则新建（只带 adminIds）；已存在则只更新
 * adminIds 一个字段，pricing / points 等其他配置段原样保留；
 * 演示用户已在名单里则不重复加（重复 init 幂等）。
 */
async function ensureDemoAdmin() {
  if (!(AppConfig.demo && AppConfig.demo.localMode)) return;
  if (!_userId) return;
  const col = _db.collection(core.models.COLLECTIONS.AppConfig);
  const doc = await col.findOne({ _id: 'singleton' });
  if (!doc) {
    await col.insert({ _id: 'singleton', adminIds: [_userId] });
    return;
  }
  const ids = Array.isArray(doc.adminIds) ? doc.adminIds : [];
  if (!ids.includes(_userId)) {
    await col.update({ _id: 'singleton' }, { adminIds: [...ids, _userId] });
  }
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
   * - 云模式（任务AD 已落地）：调云函数 whoami 取服务端认定的 openid
   *   作身份（不经 wx.login/客户端传参），再触发服务端静默建号；
   *   之后全部业务走远程 core（见文件头切换点）。
   * 失败口径：不抛死，返回 { ok:false, reason:'network' } 并清掉半成品
   * 状态，app.js 把结果存进 globalData.initState，首页据此显示
   * "网络不太顺，点这里重试"，用户点一下就再调一次 init（可重试成功）。
   * 成功返回 { ok:true }。
   */
  async init() {
    if (_db) return { ok: true, already: true };
    try {
      _syncCoreBinding();
      if (_isCloud()) {
        // 云模式（任务AD）：身份只认服务端 openid——whoami 取得后调一次
        // 业务接口触发服务端静默建号 + 注册赠分（见 ensureUser 云分支）。
        // 本地存储里的演示 id 在云模式下不作数，绝不用它当身份。
        _db = _makeDb(); // 仅作已初始化标记，云模式不读本地库
        const who = await core.whoami();
        _userId = (who && who.openid) || null;
        if (!_userId) throw new Error('callFunction:fail 未取得服务端身份');
        await ensureUser();
        return { ok: true };
      }
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
      // 演示模式自动把演示用户加进老板平台管理员名单（仅 localMode，见
      // ensureDemoAdmin）；失败不阻断启动，老板平台进不去时重新编译即可
      try { await ensureDemoAdmin(); } catch (e) { /* ignore */ }
      return { ok: true };
    } catch (e) {
      _db = null; // 清掉半成品，保证重试能从干净状态重来
      _cloudUserReady = false;
      return { ok: false, reason: 'network' };
    }
  },

  get userId() { return _userId; },
  get localMode() { return !_isCloud(); },

  // —— 个人资料与隐私同意（任务Q1） ——
  /** 我的资料：{ displayName(显示名,无昵称时按账号生成「礼友＋数字」), nickname(原始存值), avatarUrl } */
  async getProfile() {
    await ensureUser();
    return core.users.getProfile(_db, _userId);
  },
  /** 陪伴天数（我的页新方块用）：注册日起算、当天算第 1 天；无注册日返回 null */
  async getCompanionDays() {
    const user = await ensureUser();
    const direct = core.users.companionDays(user && user.createdAt);
    if (direct !== null) return direct;
    // 无注册日：走服务端兜底（注册赠送流水）；云函数未重部署、新接口不存在时
    // 走客户端流水列表兜底（100 条内），仍无则 null，不造假数
    try {
      if (typeof core.users.getCompanionDays === 'function') {
        const days = await core.users.getCompanionDays(_db, _userId);
        if (days !== null && days !== undefined) return days;
      }
    } catch (e) { /* 旧云函数未部署时走客户端兜底 */ }
    try {
      const list = await core.points.listLedger(_db, _userId, { limit: 100 });
      const entry = (list || []).find((e) => e && e.kind === 'register_grant' && e.refId === `register:${_userId}`);
      return core.users.companionDays(entry && entry.createdAt);
    } catch (e) { return null; }
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
  // opts.force：跳过缓存读（亲友页每次 onShow 强制刷新用）；写缓存带归属，未登录不缓存
  async listContacts(opts = {}) {
    const force = !!(opts && opts.force);
    if (!force && _listCache.contacts && _listCacheOwner === _userId) return _listCache.contacts.slice();
    // 未登录时不查、不缓存：调用方在 init 完成后重查即恢复（2026-10-31 缓存污染）
    if (!_userId) return [];
    const list = await core.contacts.listContacts(_db, _userId, _userId);
    _cacheList('contacts', list);
    return list.slice();
  },
  async searchContacts(keyword) {
    return core.contacts.searchContacts(_db, _userId, _userId, keyword);
  },
  async createContact({ name, remark }) {
    try {
      const r = await core.contacts.createContact(_db, _userId, _userId, { name, remark });
      // 写穿缓存：新联系人立刻在列表里（核心列表按 createdAt 升序，新建的排最后）
      if (_listCache.contacts && r && r._id) {
        _listCache.contacts = [..._listCache.contacts, {
          _id: r._id, ownerId: _userId, name: (name || '').trim(), remark: remark || '',
          createdBy: _userId, createdAt: Date.now(),
        }];
      }
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateContact(contactId, { name, remark }) {
    try {
      const r = await core.contacts.updateContact(_db, _userId, _userId, contactId, { name, remark });
      if (_listCache.contacts) {
        _listCache.contacts = _listCache.contacts.map((c) => (c._id === contactId ? { ...c, name, remark } : c));
      }
      _dirtyWanglai(); // 往来行显示姓名/备注
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 两步删除：先返回影响条数，确认后再传 confirmed=true 真删 */
  async deleteContact(contactId, confirmed = false) {
    try {
      const r = await core.contacts.deleteContact(_db, _userId, _userId, contactId, confirmed);
      if (confirmed && r && r.confirmed) {
        if (_listCache.contacts) {
          _listCache.contacts = _listCache.contacts.filter((c) => c._id !== contactId);
        }
        _dirtyLists('gifts', 'eventsStats'); // 删联系人连带删其全部往来记录
        _dirtyWanglai();
        _eventDetailCache.clear();
      }
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },

  // —— 送礼 ——
  async listGifts() {
    if (_listCache.gifts && _listCacheOwner === _userId) return _listCache.gifts.slice();
    if (!_userId) return [];
    const list = await core.gifts.listGifts(_db, _userId, _userId);
    // 最新在上
    const sorted = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    _cacheList('gifts', sorted);
    return sorted.slice();
  },
  async createGift({ contactId, tagId, amountFen, remark, date }) {
    try {
      const r = await core.gifts.createGift(_db, _userId, _userId, {
        contactId, tagId, amount: amountFen, remark, date,
      });
      await evalInviteQuiet(); // 送礼记录是邀请奖励的有效动作之一
      // 写穿缓存：新记录立刻在送礼列表最上方（列表按 createdAt 倒序）
      _dirtyWanglai();
      if (_listCache.gifts && r && r._id) {
        _listCache.gifts = [{
          _id: r._id, ownerId: _userId, contactId, tagId, amount: amountFen,
          remark: remark || '', date, createdBy: _userId, createdAt: Date.now(),
        }, ..._listCache.gifts];
      }
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateGift(giftId, patch) {
    try {
      const r = await core.gifts.updateGift(_db, _userId, _userId, giftId, patch);
      if (_listCache.gifts) {
        _listCache.gifts = _listCache.gifts.map((g) => (g._id === giftId ? { ...g, ...patch } : g));
      }
      _dirtyWanglai();
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async deleteGift(giftId) {
    try {
      const r = await core.gifts.deleteGift(_db, _userId, _userId, giftId);
      if (_listCache.gifts) _listCache.gifts = _listCache.gifts.filter((g) => g._id !== giftId);
      _dirtyWanglai();
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getGift(giftId) {
    // 补记账人显示名在 core.gifts.getGift 内完成（任务Q1/AD，与原直连拼装同口径）
    return core.gifts.getGift(_db, _userId, _userId, giftId);
  },
  /** 送礼详情一次取齐（记录+联系人名，1 趟云端往返） */
  async getGiftDetail(giftId) {
    try { return await core.gifts.getGiftDetail(_db, _userId, _userId, giftId); }
    catch (e) { throw new Error(friendly(e)); }
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
    const user = (await core.users.getSelf(_db, _userId)) || {};
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
  async getQuotaUsage() {
    const me = await ensureUser();
    const quota = core.quota.getEffectiveQuota(me, AppConfig, Date.now(), await inviteOpts());
    // 已用计数经 export.buildExportData 只读聚合取（任务AD：本地/云端共用一条路径）
    const summary = await core.export.buildExportData(_db, _userId, _userId);
    const receivePool = await core.quota.computePoolUsed(_db, _userId, quota.recordsPerEvent);
    return {
      state: core.quota.getMembershipState(me),
      quota,
      used: { events: summary.events.length, receivePool, gifts: summary.gifts, contacts: summary.contacts },
    };
  },

  /** 会员到期三次提醒：到期前15天 / 到期当天 / 缓冲期结束前 */
  getReminderInfo() {
    return core.users.getSelf(_db, _userId).then((user) => {
      const times = core.quota.getReminderSchedule(user || {});
      const labels = ['到期前 15 天', '到期当天', '缓冲期结束前'];
      const nowT = Date.now();
      return times.map((t, i) => ({ label: labels[i], at: t, passed: nowT >= t, date: new Date(t).toLocaleDateString('zh-CN') }));
    });
  },

  // —— 支付与会员订单（任务K：适配层 + 模拟支付） ——
  /** 生效价格档位：老板平台配置优先、否则静态占位价；金额已格式化，页面不写死价格。
   * 真适配器批：显示价按终端平台取（安卓价/苹果价，缺省跟现价），用户在
   * 应用里只看到自己手机平台的价（苹果端不提示去安卓付）。 */
  async getPricing(platform) {
    const plans = await core.payment.resolvePricing(_db);
    return plans.map((p) => ({ ...p, priceText: core.format.formatAmount(platformPriceFenOf(p, platform)) }));
  },

  /**
   * 购买会员：本地演示走 Mock 模拟支付（默认成功，走与真实通道相同的
   * 建单→调起→回调发货链路）；云模式由 api 分发在服务端注入真适配器：
   * 建单只返回 payParams（不发货），页面拿它调 wx.requestVirtualPayment，
   * 发货以平台发货推送为准（本方法返回 pendingPay + payParams，页面轮询订单）。
   * @param {string} planId 档位 id
   * @param {{platform?:string, loginCode?:string}} opts 平台与登录码（页面传入，
   *   云模式经 RPC 原样透传到服务端建单签名用；loginCode 由页面 wx.login 实时取）
   */
  async purchaseMembership(planId, opts = {}) {
    try {
      // 支付适配器不能跨 RPC：本地模式本地注入 Mock；云模式传平台与登录码，
      // 由 api 分发在服务端注入真适配器（见 cloudfunctions/api/index.js）。
      // sessionKey 仅测试用（回环测试免网络签名）；页面只传 loginCode。
      const callOpts = _isCloud() ? { platform: opts.platform, loginCode: opts.loginCode, sessionKey: opts.sessionKey } : { adapter: new coreLib.payAdapter.MockPayAdapter({ result: 'success' }) };
      const r = await core.payment.purchase(_db, _userId, planId, callOpts);
      if (r.pendingPay) return { delivered: false, pendingPay: true, payParams: r.payParams, productId: r.productId, order: presentOrder(r.order) };
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

  /** 生效积分规则（数字全部读配置：注册赠送/拍照单价/礼包档位，礼包金额已格式化；
   * 真适配器批：显示价按终端平台取，与套餐同口径） */
  async getPointsSettings(platform) {
    const s = await core.points.resolvePointsSettings(_db);
    return {
      registerGrant: s.registerGrant,
      photoImportCost: s.photoImportCost,
      packs: (s.packs || []).map((p) => ({ ...p, priceText: core.format.formatAmount(platformPriceFenOf(p, platform)) })),
    };
  },

  /**
   * 购买积分礼包：仅会员可买（core 下单层校验，非会员不产生订单）。
   * 本地演示走 Mock 模拟支付，链路与套餐购买同构；云模式走真适配器，
   * 返回 pendingPay + payParams（页面调起虚拟支付、轮询订单），与套餐同口径。
   */
  async purchasePointsPack(packId, opts = {}) {
    try {
      // 适配器注入方式同 purchaseMembership（云模式由服务端注入真适配器；
      // sessionKey 仅测试用，页面只传 loginCode）
      const callOpts = _isCloud() ? { platform: opts.platform, loginCode: opts.loginCode, sessionKey: opts.sessionKey } : { adapter: new coreLib.payAdapter.MockPayAdapter({ result: 'success' }) };
      const r = await core.payment.purchasePointsPack(_db, _userId, packId, callOpts);
      if (r.pendingPay) return { delivered: false, pendingPay: true, payParams: r.payParams, productId: r.productId, order: presentOrder(r.order) };
      return { delivered: r.delivered, order: presentOrder(r.order) };
    } catch (e) {
      if (e && (e.code === 'points-pack-member-only' || e.code === 'points-pack-not-found')) {
        throw new Error(e.message);
      }
      throw new Error(friendly(e));
    }
  },

  /** 取一张订单（购买页轮询发货状态用；仅本人可见） */
  async getOrder(orderId) {
    try {
      const o = await core.payment.getOrderForUser(_db, _userId, orderId);
      return presentOrder(o);
    } catch (e) { throw new Error(friendly(e)); }
  },

  /**
   * 购买页聚合数据（任务P2）：会员状态 + 积分余额 + 套餐 + 礼包 +
   * 本终端购买开关。平台开关的生效值 = 静态配置 ← 老板平台
   * appConfig 文档 paymentPlatforms 覆盖，合并后交 core 的纯函数判定，
   * 页面只读结果、不写死任何平台判断。
   * @param {string} platform 设备平台（wx.getDeviceInfo().platform，如 'ios'/'android'）
   */
  async getPurchasePageData(platform) {
    // 五个读互相独立，必须并发（2026-10-24 真机反馈：串行 5 个云端往返
    // 让购买页套餐 3~4 秒才出现；并发后约等于 1 个往返）
    const [membership, pointsBalance, plans, settings, platformOverrides, serverRefundNotice] = await Promise.all([
      this.getMembership(),
      this.getPointsBalance(),
      this.getPricing(platform),
      this.getPointsSettings(platform),
      (async () => {
        try { return await core.payment.getPaymentPlatforms(_db, _userId); }
        catch (e) { return null; /* 读不到覆盖就用静态配置 */ }
      })(),
      (async () => {
        try { return await core.payment.getRefundNotice(_db, _userId); }
        catch (e) { return null; /* 读不到云端文案就用静态短句兜底 */ }
      })(),
    ]);
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
      refundNotice: serverRefundNotice || (AppConfig.payment && AppConfig.payment.refundNotice) || '',
      isDemo: !_isCloud(),
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
      return await core.share.getGrant(_db, _userId, membershipId);
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
      const list = await core.share.listReceived(_db, _userId);
      // 账本主人显示名走统一解析（任务Q1）：其当前昵称，无昵称显示"微信用户"；
      // 主人文档已不存在（已注销）时才兜底叫"家人"
      return list.map((ms) => ({
        membershipId: ms.membershipId,
        ownerId: ms.ownerId,
        ownerName: ms.owner ? core.users.displayName(ms.owner) : '家人',
        createdAt: ms.createdAt,
      }));
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 接受邀请 */
  async acceptShare(membershipId) {
    try {
      return await core.share.accept(_db, _userId, membershipId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 按邀请码（membershipId）查共享关系文档（ownerId/status/memberId），供分享落地页接受邀请 */
  async getShareMembership(membershipId) {
    try {
      return await core.share.getMembership(_db, _userId, membershipId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 当前用户 id（页面侧需要比对"是不是自己"时用） */
  getMyUserId() { return _userId; },
  /** 家人视角：已授权给我的礼薄列表（只含授权事件） */
  async listMemberEvents(ownerId) {
    try {
      return await core.stats.memberEvents(_db, _userId, ownerId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 共享开关清单（供邀请页渲染） */
  getShareSwitches() { return AppConfig.shareSwitches; },
  /** 当前账本数据情况（导出页概览）：经 core.export.buildExportData 只读聚合（任务AD） */
  async exportSummary() {
    return core.export.buildExportData(_db, _userId, _userId);
  },
  /**
   * 导出 xlsx：经云函数生成真文件。
   * 本地模式下 exceljs 不可用，直接提示云联调后可用。
   */
  async exportXlsx({ eventIds = null, includeGifts = true } = {}) {
    if (AppConfig.demo.localMode) {
      throw new Error('导出功能需要云环境，云联调后可用');
    }
    // 传输：测试注入回环时走注入通道；生产走 wx.cloud.callFunction（与 remote-core 同路）
    const env = _transportForTest
      ? await _transportForTest({ action: 'exportXlsx', eventIds, includeGifts })
      : (await wx.cloud.callFunction({
        name: 'api',
        data: { action: 'exportXlsx', eventIds, includeGifts },
      })).result;
    // 云函数回的是统一信封 { ok, data } / { ok:false, error }：解开后只把
    // data（{ fileId, fileName }）给页面（任务AE：此前页面直接在信封上找
    // fileId 恒为空、真机导出必报"云端未返回文件"）
    if (!env || env.ok !== true) {
      throw new Error((env && (env.error || env.reason)) || '导出失败，请稍后重试');
    }
    return env.data;
  },
  /** 写导出历史（经 core.importer.recordExportJob 落库，任务AD：本地/云端共用一条路径） */
  async logExportJob(scope) {
    await core.importer.recordExportJob(_db, _userId, { scope });
  },
  /** 导出历史记录 */
  async listExportJobs() {
    return core.importer.listExportJobs(_db, _userId);
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

  // —— 拍照导入（阶段4；AQ批起服务端可选腾讯云真实识别） ——
  /**
   * 开始拍照导入任务 → { jobId, items, cost, photoFileIds }
   * core 任务流顺序：会员门禁 → 积分预检 → 识别 → 识别成功后扣积分。
   * 抛错带 code：'member-required'（非会员）/ 'insufficient-points'（积分不足，
   * 识别前拦截、未扣款），页面据此弹不同引导；识别失败为普通错误（未扣款）。
   * opts.jobId 复用同一任务时传入（重试不重复扣费）；opts.eventId 收礼必传。
   *
   * 照片送达（AR批）：云模式下本地临时路径在服务端取不到图（AQ 适配器按
   * fileID 取图），故启动任务前先把照片按原顺序上传云存储（ocr-imports/
   * 前缀），任务入参只传 imageFileIds、不再传本地路径；上传任一张失败 →
   * 直接抛「照片上传失败」停在页面，不启动任务、不扣分。本地演示模式
   * 不上传、仍传 imagePath，行为与此前一致。
   * imagePath 可传单张字符串或多张数组（保持顺序）；photoFileIds 随结果
   * 返回，供核对页在确认写入成功后清理云端照片（见 cleanupImportPhotos）。
   */
  async recognizePhoto(imagePath, kind, opts = {}) {
    let imageFileIds = null;
    if (_isCloud()) {
      const paths = (Array.isArray(imagePath) ? imagePath : [imagePath]).filter((p) => !!p);
      if (!paths.length) throw new Error('请先拍照');
      const upload = _uploaderForTest || defaultUploader;
      imageFileIds = [];
      for (let i = 0; i < paths.length; i++) {
        let fileID = '';
        try {
          fileID = await upload(_ocrCloudPath(paths[i], i), paths[i]);
        } catch (e) {
          const err = new Error('照片上传失败，请检查网络后重试');
          if (e && e.errMsg) err.errMsg = e.errMsg;
          throw err;
        }
        if (!fileID) throw new Error('照片上传失败，请检查网络后重试');
        imageFileIds.push(fileID);
      }
    }
    try {
      const r = await core.importer.startImportTask(_db, _userId, _userId, {
        jobId: opts.jobId || '',
        kind,
        eventId: opts.eventId || '',
        ...(imageFileIds ? { imageFileIds } : { imagePath }),
        provider: opts.provider,
        fail: opts.fail,
      });
      return { jobId: r.jobId, items: r.items, cost: r.cost, photoFileIds: imageFileIds || [] };
    } catch (e) {
      const err = new Error(friendly(e));
      if (e && e.code) err.code = e.code;
      throw err;
    }
  },
  /**
   * 清理本次导入上传的云端照片（AR批）：核对页确认写入成功后调用，
   * 删掉 ocr-imports/ 下这批原件。尽力而为——删除失败静默，照片留存
   * 不该影响已完成的导入结果；本地模式没有上传过照片（photoFileIds
   * 为空）天然无操作。用户中途放弃核对（未确认写入）的照片没有现成
   * 的丢弃钩子可挂，不在此清理（留存口径见 docs/OCR腾讯云接入.md）。
   */
  async cleanupImportPhotos(photoFileIds) {
    const list = (Array.isArray(photoFileIds) ? photoFileIds : [])
      .filter((f) => typeof f === 'string' && f.startsWith('cloud://'));
    if (!list.length || !_isCloud()) return;
    try {
      const del = _deleterForTest || defaultDeleter;
      await del(list);
    } catch (e) { /* 清理失败不影响导入结果 */ }
  },
  // —— 收礼礼薄（事件）——
  /** 收礼礼薄列表（导入前先选） */
  async listEvents() {
    return core.receive.listEvents(_db, _userId, _userId);
  },
  /** 礼薄列表页一次取齐：每本带 count/totalFen（替代逐本 getEventStats 的 N+1 往返） */
  async listEventsWithStats() {
    if (_listCache.eventsStats && _listCacheOwner === _userId) return _listCache.eventsStats.slice();
    if (!_userId) return [];
    try {
      const list = await core.receive.listEventSummaries(_db, _userId, _userId);
      _cacheList('eventsStats', list);
      return list.slice();
    } catch (e) { throw new Error(friendly(e)); }
  },
  async createEvent({ name, tagId, date, remark }) {
    try {
      const r = await core.receive.createEvent(_db, _userId, _userId, { name, tagId, date, remark });
      // 写穿缓存：新礼薄立刻出现在列表最上方（0 条 0 元）
      const ev = (r && r.event) || r;
      if (_listCache.eventsStats && ev && ev._id) {
        _listCache.eventsStats = [{
          _id: ev._id, ownerId: _userId, name, tagId, date, remark: remark || '',
          createdBy: _userId, createdAt: Date.now(), count: 0, totalFen: 0,
        }, ..._listCache.eventsStats];
      }
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateEvent(eventId, patch) {
    try {
      const r = await core.receive.updateEvent(_db, _userId, _userId, eventId, patch);
      if (_listCache.eventsStats) {
        _listCache.eventsStats = _listCache.eventsStats.map((e) => (e._id === eventId ? { ...e, ...patch } : e));
      }
      _eventDetailCache.delete(eventId);
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 删除礼薄：返回 {removedRecords}（连带删除的明细条数），供弹窗展示 */
  async deleteEvent(eventId) {
    try {
      const r = await core.receive.deleteEvent(_db, _userId, _userId, eventId);
      if (_listCache.eventsStats) {
        _listCache.eventsStats = _listCache.eventsStats.filter((e) => e._id !== eventId);
      }
      _eventDetailCache.delete(eventId);
      _dirtyWanglai(); // 删礼薄连带删其收礼记录
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getEvent(eventId) {
    return core.receive.getEvent(_db, _userId, _userId, eventId);
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
      // 写穿缓存：礼薄列表的条数/合计即时更新；礼薄详情若在缓存里，新记录插到最上方
      if (_listCache.eventsStats) {
        _listCache.eventsStats = _listCache.eventsStats.map((e) => (e._id === eventId
          ? { ...e, count: (e.count || 0) + 1, totalFen: (e.totalFen || 0) + amountFen }
          : e));
      }
      _dirtyWanglai();
      const det = _eventDetailCache.get(eventId);
      if (det && r && r._id) {
        const cDoc = (_listCache.contacts || []).find((c) => c._id === contactId);
        det.records = [{
          _id: r._id, ownerId: _userId, eventId, contactId, amount: amountFen,
          type, remark: remark || '', date, createdBy: _userId, createdAt: Date.now(),
          contactName: cDoc ? cDoc.name : '',
        }, ...det.records];
        det.count += 1;
        det.totalFen += amountFen;
      }
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateRecord(recordId, patch) {
    try {
      const r = await core.receive.updateRecord(_db, _userId, _userId, recordId, patch);
      _dirtyLists('eventsStats'); // 金额/归属可能变，礼薄汇总整表作废重取
      _eventDetailCache.clear();
      _dirtyWanglai();
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async deleteRecord(recordId) {
    try {
      const r = await core.receive.deleteRecord(_db, _userId, _userId, recordId);
      _dirtyLists('eventsStats');
      _eventDetailCache.clear();
      _dirtyWanglai();
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getRecord(recordId) {
    // 补记账人显示名在 core.receive.getRecord 内完成（任务Q1/AD，与原直连拼装同口径）
    return core.receive.getRecord(_db, _userId, _userId, recordId);
  },
  /** 礼薄详情一次取齐（礼薄+明细+联系人名+合计，1 趟）；会话内缓存，写操作精确同步 */
  async getEventDetail(eventId) {
    if (_eventDetailCache.has(eventId)) return _eventDetailCache.get(eventId);
    try {
      const d = await core.receive.getEventDetail(_db, _userId, _userId, eventId);
      if (d) _eventDetailCache.set(eventId, d);
      return d;
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 收礼记录详情一次取齐（记录+联系人+所属礼薄，1 趟） */
  async getRecordDetail(recordId) {
    try { return await core.receive.getRecordDetail(_db, _userId, _userId, recordId); }
    catch (e) { throw new Error(friendly(e)); }
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
    const own = oid === _userId;
    const key = own ? JSON.stringify(range || null) : null;
    if (own && _wanglaiCache.has(key)) return _wanglaiCache.get(key);
    try {
      // 服务端一趟取齐（core.stats.wanglaiList）：旧实现逐个联系人调
      // contactStats，云端每人一趟往返，是往来页最大的隐藏延迟
      const r = await core.stats.wanglaiList(_db, _userId, oid, { range });
      if (own) _wanglaiCache.set(key, r);
      return r;
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 按账本主人读联系人（横置礼单本等用）：看自己账本走列表缓存，看成员共享账本直查 */
  async listContactsFor(ownerId) {
    if (!ownerId || ownerId === _userId) return this.listContacts();
    try { return await core.contacts.listContacts(_db, _userId, ownerId); }
    catch (e) { throw new Error(friendly(e)); }
  },
  /** 往来页搜索：输入姓名出联系人（成员视角自动只搜可见的）；
   * BV批：只出有往来记录的人（无记录的同名联系人不再冒出第二条空结果） */
  async searchWanglaiContacts({ ownerId, keyword } = {}) {
    const oid = ownerId || _userId;
    try {
      return await core.contacts.searchContactsWithRecords(_db, _userId, oid, keyword || '');
    } catch (e) { throw new Error(friendly(e)); }
  },
  /**
   * 竖线树数据（成员视角自动过滤未授权记录）
   * @returns {items, receiveTotalFen, receiveCount, giftTotalFen, giftCount, diffFen, isMember}
   */
  async getTimeline({ contactId, ownerId, range } = {}) {
    const oid = ownerId || _userId;
    // 本人账本走会话缓存（AH批）：存「在途 promise」实现去重——页面 onLoad 与
    // onShow 首开各调一次 reload，此前是两批完整云端往返（真机 2 秒多的主因
    // 之一）；任一记录/联系人变更经 _dirtyWanglai 整表作废，不会读到旧数据。
    // 成员视角（看他人账本）不缓存，口径与往来列表一致。
    const own = oid === _userId;
    const key = own ? `${oid}|${contactId}|${JSON.stringify(range || null)}` : null;
    if (own && _timelineCache.has(key)) return _timelineCache.get(key);
    const p = (async () => {
      try {
        // 竖线树与联系人详情互相独立，并发取（原来串行多一个云端往返）
        const [tl, c] = await Promise.all([
          core.stats.memberTimeline(_db, _userId, oid, contactId, { range }),
          this.getContact(contactId, oid),
        ]);
        return { ...tl, contactName: c ? c.name : '' };
      } catch (e) { throw new Error(friendly(e)); }
    })();
    if (own) {
      _timelineCache.set(key, p);
      p.catch(() => { if (_timelineCache.get(key) === p) _timelineCache.delete(key); });
    }
    return p;
  },
  async getContact(contactId, ownerId) {
    const oid = ownerId || _userId;
    return core.contacts.getContact(_db, _userId, oid, contactId);
  },

  // —— 首页小结与最近往来（任务V） ——
  /**
   * 首页本月小结：只统计**本人账本**（ownerId 恒为当前用户；成员视角能看的
   * 他人共享账本走 listEventsFor/getWanglaiList 等带 ownerId 的接口，不混入这里）。
   * 本月 = 设备本地日期的自然月，按记录 date 的 YYYY-MM 前缀判定。
   * 金额返回整数分，页面用 formatAmountInt 按整数场景口径显示。
   * @returns {{receiveFen, receiveCount, giftFen, giftCount, hasRecords}}
   *   hasRecords=false（本月一笔都没有）时页面显示"本月还没有记录"，不显示 ¥0。
   */
  /** 首页全量数据的在途去重（并发调用共享同一趟；落定即释放，不缓存旧数据） */
  async _homeDataOnce() {
    if (!_homeDataInflight) {
      _homeDataInflight = core.stats.getHomeData(_db, _userId)
        .finally(() => { _homeDataInflight = null; });
    }
    return _homeDataInflight;
  },
  async getHomeSummary() {
    const nowD = new Date();
    const prefix = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = (r) => typeof r.date === 'string' && r.date.startsWith(prefix);
    // 原始数据经 stats.getHomeData 一次取齐（任务AD：本地/云端共用一条路径），月份过滤仍在本地
    const home = await this._homeDataOnce();
    const receives = home.receives.filter(inMonth);
    const gifts = home.gifts.filter(inMonth);
    const sum = (list) => list.reduce((s, r) => s + (r.amount || 0), 0);
    return {
      receiveFen: sum(receives), receiveCount: receives.length,
      giftFen: sum(gifts), giftCount: gifts.length,
      hasRecords: receives.length + gifts.length > 0,
    };
  },

  /**
   * 首页最近往来：本人账本的收礼记录与送礼记录两类**合并**，按 date 倒序
   * （同日按 createdAt 倒序）取前 limit 条。只读真实记录，不拼凑任何数据
   * （演示模式下种子即真实落库记录，自然命中）。
   * 每条归一化为页面可直接渲染的形状：金额走现行 formatAmount 两位小数
   * （收 +X.XX / 送 -X.XX，与送礼列表、竖线树同口径）；收礼的 tagName 为
   * 礼薄标签名、eventName 为礼薄名，送礼的 tagName 为场合标签名。
   * @returns {[{kind:'receive'|'gift', contactName, tagName, eventName,
   *            dateText, amountText, targetUrl}]} 无记录返回 []
   */
  async getHomeRecent(limit = 3) {
    const n = Math.max(0, Math.floor(Number(limit)) || 0);
    if (n === 0) return [];
    // 原始数据经 stats.getHomeData 一次取齐（任务AD）；原先按 id 集合的定向
    // 查询改为在全量本人数据里按同一 id 集合过滤，结果完全一致
    const home = await this._homeDataOnce();
    const receives = home.receives;
    const gifts = home.gifts;
    if (!receives.length && !gifts.length) return [];
    const contactIds = [...new Set([...receives, ...gifts].map((r) => r.contactId).filter(Boolean))];
    const contacts = contactIds.length
      ? home.contacts.filter((c) => contactIds.includes(c._id))
      : [];
    const contactName = new Map(contacts.map((c) => [c._id, c.name]));
    const eventIds = [...new Set(receives.map((r) => r.eventId).filter(Boolean))];
    const events = eventIds.length
      ? home.events.filter((e) => eventIds.includes(e._id))
      : [];
    const eventById = new Map(events.map((e) => [e._id, e]));
    const tagNameOf = (tagId) => {
      const t = AppConfig.tags.find((x) => x.id === tagId);
      return t ? t.name : '';
    };
    const dateTextOf = (date) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
      return m ? `${Number(m[2])}月${Number(m[3])}日` : (date || '');
    };
    const merged = [
      ...receives.map((rec) => ({ kind: 'receive', rec })),
      ...gifts.map((rec) => ({ kind: 'gift', rec })),
    ].sort((a, b) => {
      const da = a.rec.date || '';
      const dbd = b.rec.date || '';
      if (da !== dbd) return da < dbd ? 1 : -1;
      const ca = a.rec.createdAt || 0;
      const cb = b.rec.createdAt || 0;
      if (ca !== cb) return cb - ca;
      return String(b.rec._id).localeCompare(String(a.rec._id));
    });
    return merged.slice(0, n).map(({ kind, rec }) => {
      const isReceive = kind === 'receive';
      const ev = isReceive ? (eventById.get(rec.eventId) || {}) : {};
      return {
        kind,
        contactName: contactName.get(rec.contactId) || '—',
        tagName: tagNameOf(isReceive ? ev.tagId : rec.tagId),
        eventName: isReceive ? (ev.name || '') : '',
        dateText: dateTextOf(rec.date),
        amountText: isReceive
          ? `+${core.format.formatAmount(rec.amount || 0)}`
          : core.format.formatAmount(-(rec.amount || 0)),
        targetUrl: isReceive
          ? `/pages/receive-record-detail/receive-record-detail?id=${rec._id}`
          : `/pages/gift-detail/gift-detail?id=${rec._id}`,
      };
    });
  },
  /**
   * 确认写入识别结果；core 整批原子校验：任一条不合格整批不写。
   * 成功返回 { written, total }；失败抛错（err.written/err.total 为已写入/总数，
   * err.itemIndex 为出问题那条的下标，页面据此高亮定位），
   * 额度类错误消息为卖惨文案，直接展示。
   */
  async importWrite({ kind, eventId, items, jobId }) {
    const r = await core.importer.writeImport(_db, _userId, _userId, { kind, eventId, items, jobId });
    if (!r.rawError && r.written > 0) {
      _dirtyLists('gifts', 'eventsStats');
      _eventDetailCache.clear();
      _dirtyWanglai();
    }
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
    return core.share.getMyGrantFor(_db, _userId, ownerId);
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
    return core.admin.overview(_db, _userId);
  },
  async adminMemberList({ page, pageSize, memberState } = {}) {
    try {
      return await core.admin.memberList(_db, _userId, { page, pageSize, memberState });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async adminSetMemberPlan(maskedUserId, plan, days) {
    try {
      // 审计操作者标记由 core.admin 按 'admin:<actorId>' 口径派生（与旧行为一致）
      return await core.admin.setMemberPlan(_db, _userId, maskedUserId, plan, days);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async adminQuotaUsage(maskedUserId) {
    try {
      return await core.admin.quotaUsage(_db, _userId, maskedUserId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async adminInviteStats() {
    return core.admin.inviteStats(_db, _userId);
  },
  async adminShareOverview({ limit } = {}) {
    return core.admin.shareOverview(_db, _userId, { limit });
  },
  // —— 老板平台补全（任务M）：以下接口 core 侧一律校验管理员身份
  // （只认 appConfig 文档 adminIds；本地演示模式下 init 已自动把演示
  // 用户写进名单，见 ensureDemoAdmin；正式环境名单由后台维护）——
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
  /** 添加管理员（仅云端导入的管理员可操作，服务端校验分档） */
  async adminAddAdmin(maskedId) {
    try { return await core.admin.addAdmin(_db, _userId, { maskedId }); }
    catch (e) { throw new Error(friendly(e)); }
  },
  /** 移除管理员（同上；服务端拦最后一位云端管理员） */
  async adminRemoveAdmin(maskedId) {
    try { return await core.admin.removeAdmin(_db, _userId, { maskedId }); }
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
  async adminUpdateLaunchSwitches(switches) {
    try { return await core.admin.updateLaunchSwitches(_db, _userId, switches); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async adminUpdateRefundNotice(text) {
    try { return await core.admin.updateRefundNotice(_db, _userId, text); }
    catch (e) { throw new Error(friendly(e)); }
  },

  /** 当前用户是不是老板平台管理员：结论只认服务端名单（appConfig.adminIds）。
   * 「我的」页隐藏入口据此决定显隐（任务AF：非管理员连点版本号无入口无提示）。
   * 出错一律按"不是"处理（fail closed）。 */
  async isAdmin() {
    try { return !!(await core.admin.isAdmin(_db, _userId)); }
    catch (e) { return false; }
  },

  _featureFlagsCache: null,
  /** 生效功能开关 { photoImport, eInvitation, familyShare }：服务端
   * appConfig 文档优先、静态默认兜底；会话内缓存（老板改开关后重开小程序生效）。 */
  async getFeatureFlags() {
    if (this._featureFlagsCache) return this._featureFlagsCache;
    const base = AppConfig.features || {};
    let flags = {
      photoImport: !!base.photoImport, eInvitation: !!base.eInvitation, familyShare: !!base.familyShare,
      maintenance: !!base.maintenance, registration: !!base.registration, landscape: !!base.landscape,
      memberOnly: Array.isArray(AppConfig.memberOnlyFeatures) ? [...AppConfig.memberOnlyFeatures] : [],
    };
    try {
      const f = await core.features.getFlags(_db, _userId);
      if (f) {
        for (const k of ['photoImport', 'eInvitation', 'familyShare', 'maintenance', 'registration', 'landscape']) {
          if (typeof f[k] === 'boolean') flags[k] = f[k];
        }
        if (Array.isArray(f.memberOnly)) flags.memberOnly = [...f.memberOnly];
      }
    } catch (e) { /* 取不到按静态默认（第一版为关） */ }
    this._featureFlagsCache = flags;
    return flags;
  },

  // —— 电子请柬（2026-10-21 用户决定：取消自制请柬，改为跳转外部小程序） ——
  /** 外部请柬小程序配置 { miniprogramName, appId }（app-config.externalInvitation；
   * appId 为空表示尚未配置，首页入口点按提示「敬请期待」） */
  getExternalInvitation() {
    return AppConfig.externalInvitation || { miniprogramName: '', appId: '' };
  },

  // BW批：首页缓存归属校验用（换号不闪旧账；未初始化时返回 null）
  getCurrentUserId() {
    return _userId;
  },
};

// 供测试与 app.js 网络提示复用（不属于页面接口）
service._isNetworkError = isNetworkError;
service.NETWORK_HINT = NETWORK_HINT;
// 仅测试用：注入 db 工厂（模拟初始化失败/恢复）与复位单例状态
service._setDbFactoryForTest = (fn) => { _dbFactory = fn || null; };
// 仅测试用（任务AD）：注入模式与远程传输——回环测试把传输接到
// cloudfunctions/api 的 createMain（假 SDK），在进程内跑通全链路；
// 页面与生产路径恒不设这两个注入口
service._setModeForTest = (mode) => { _modeForTest = mode || null; _remoteCore = null; };
service._setTransportForTest = (fn) => { _transportForTest = fn || null; _remoteCore = null; };
// 仅测试用（AR批）：注入云存储上传/删除假实现——回环/行为测试在进程内
// 模拟 wx.cloud.uploadFile/deleteFile，断言拍照导入的上传与清理链路；
// 页面与生产路径恒不设这两个注入口
service._setUploaderForTest = (fn) => { _uploaderForTest = fn || null; };
service._setDeleterForTest = (fn) => { _deleterForTest = fn || null; };
service._resetForTest = () => {
  _db = null; _userId = null; _dbFactory = null;
  _listCache = { contacts: null, gifts: null, eventsStats: null };
  _eventDetailCache.clear();
  _wanglaiCache.clear();
  _timelineCache.clear();
  _homeDataInflight = null;
  service._featureFlagsCache = null;
  _modeForTest = null; _transportForTest = null; _remoteCore = null;
  _uploaderForTest = null; _deleterForTest = null;
  _cloudUserReady = false;
  core = coreLib;
};

module.exports = service;
