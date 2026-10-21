/**
 * 礼单簿 · 应用配置中心
 * v3.1 决策更新版 - 冻结配置项
 *
 * ================================================================
 * ★ 换成正式版时，需要用户填的只有两样东西（全局只有这两处来源）：
 *   ① 本文件的 cloudEnvId（紧挨着下面）：填云开发控制台里的「环境 ID」
 *   ② 项目根目录 project.config.json 的 appid：填小程序的 AppID
 * 其余代码一律从这两处读，不许把这两个值写死在别的地方。
 * 本地预览阶段两处都保持现状不动：appid 留 touristappid 就能打开预览，
 * cloudEnvId 留空即可（本地演示模式不连云）。
 * ================================================================
 *
 * 铁律：Tab 名称、免费额度、10 标签、会员规则一律从这里读取，
 * 不得在页面/组件里写死。后台可调项预留云端覆盖接口（阶段1 接 AppConfig 集合）。
 */

const AppConfig = {
  /** 云开发环境 ID（★要填的两样之一，见文件头）：开通云开发后把环境 ID 填在这里；
   * app.js 启动时读它初始化云开发，本地预览留空字符串 */
  cloudEnvId: '',

  /** 底部 Tab（顺序固定；Tab2 名称暂定"往来"，放配置不得写死） */
  tabs: [
    { id: 'index', name: '首页', pagePath: 'pages/index/index' },
    { id: 'wanglai', name: '往来', pagePath: 'pages/wanglai/wanglai' }, // 暂定名，用户保留更换权利
    { id: 'contacts', name: '亲友录', pagePath: 'pages/contacts/contacts' },
    { id: 'mine', name: '我的', pagePath: 'pages/mine/mine' },
  ],

  /** 免费额度（计数单位均为记录条数；数字放配置，后台可改） */
  freeQuota: {
    receiveEvents: 3,      // 收礼礼薄：总共可创建 3 个
    recordsPerEvent: 30,   // 每个礼薄的收礼记录：30 条
    giftRecords: 30,       // 送礼记录：30 条
    contacts: 50,          // 亲友录联系人：50 人
  },

  /** 10 个类别标签（收礼礼薄与送礼记录共用同一套；图案视觉后定，此处为占位名） */
  tags: [
    { id: 'jiehun', name: '结婚' },   // 红双喜（白事不得出现）
    { id: 'shengzi', name: '生子' },
    { id: 'tanwang', name: '探望' },
    { id: 'yasui', name: '压岁' },
    { id: 'shengri', name: '生日' },
    { id: 'shengxue', name: '升学' },
    { id: 'qiaoqian', name: '乔迁' },
    { id: 'dashou', name: '大寿' },
    { id: 'baishi', name: '白事' },
    { id: 'qita', name: '其他' },
  ],
  defaultTagId: 'jiehun', // 默认选中"结婚"

  /** 收礼记录类型 */
  recordTypes: ['红包', '现金', '转账', '微信', '支付宝'],

  /** 会员规则（具体数字待定价时再定，会员额度为占位结构） */
  membership: {
    // 会员专属功能开关（与 memberOnlyFeatures 清单对应）
    features: {
      photoImport: true,   // 拍照导入：会员功能
      redLedgerMode: true, // 经典红字大写横置礼簿模式：会员功能
    },
    // 【历史兼容字段】会员额度旧口径：自 2026-10-21 起有效会员额度改走
    // safetyCaps（不设业务额度、只设防滥用上限），getEffectiveQuota 不再读本段；
    // 本段仅供老板平台配置页展示/历史数据兼容，勿在新逻辑中引用。
    quota: {
      receiveEvents: 30,     // 会员：礼薄数（占位，待定）
      recordsPerEvent: 500,  // 会员：每礼薄记录数（占位，待定）
      giftRecords: 500,      // 会员：送礼记录数（占位，待定）
      contacts: 500,         // 会员：联系人数（占位，待定）
    },
    // 会员到期规则（用户 2026-10-18 确认：缓冲期 30 天）
    expiry: {
      gracePeriodDays: 30,       // 缓冲期 30 天
      reminders: [15, 0, -1],    // 到期前15天、到期当天、缓冲期结束前各提醒一次（-1=结束前）
      overQuotaReadonly: true,   // 超出免费额度的记录变为只读（可查可导出，不能改、不能新增）
      // 缓冲期内：家人只读（可查可导出，不能新增/修改/删除），不能新邀请；
      // 缓冲期结束后：共享暂停（家人访问被拒），数据保留，续费自动恢复
    },
  },

  /** 会员价格档位（静态默认；老板平台 appConfig 文档的 pricing 段可覆盖，覆盖优先）
   * 价格/天数/赠送积分/推荐标记/上架开关全部放配置（用户 2026-10-21 确认口径），
   * 页面与下单代码一律从配置读、不得写死任何数字；改价走老板平台 updatePricing。
   * 字段与老板平台 updatePricing 校验口径一致：
   * {id, name, priceFen(分), days, grantPoints(购买赠送积分), recommended(标"推荐"), onShelf(上架开关)}。
   * onShelf=false 即"一键下架"：购买页不显示、下单被拒（与不存在同口径）。
   */
  pricing: [
    { id: 'month', name: '月卡', priceFen: 1000, days: 30, grantPoints: 10, recommended: false, onShelf: true },
    { id: 'halfYear', name: '半年卡', priceFen: 4900, days: 180, grantPoints: 50, recommended: false, onShelf: true },
    { id: 'year', name: '年卡', priceFen: 7000, days: 365, grantPoints: 100, recommended: true, onShelf: true },
    { id: 'decade', name: '十年卡', priceFen: 19800, days: 3650, grantPoints: 500, recommended: false, onShelf: true },
  ],

  /** 积分规则（用户 2026-10-21 确认口径；数字全放配置，老板平台可覆盖 appConfig 文档 points 段）
   * - registerGrant：新用户注册赠送积分（只发一次，refId 固定保证幂等）
   * - photoImportCost：拍照录入每次消耗积分（仅会员可用且须积分足够，扣费在 core/points 原子幂等）
   * - packs：积分礼包（仅会员可买；非会员购买页置灰引导先开会员）。可多档增删。
   * 积分不过期；会员到期后保留，续费后继续可用。
   */
  points: {
    registerGrant: 15,
    photoImportCost: 5,
    packs: [
      { id: 'pack5', name: '积分包', priceFen: 500, points: 5 },
    ],
  },

  /** 电子请柬（2026-10-21 用户决定：取消自制请柬，首页入口改为跳转合作小程序）
   * - miniprogramName / appId 由用户提供后填入；appId 为空时入口点按提示「敬请期待」。
   * - 填 appId 时须同步把该 AppID 加入 app.json 顶层 navigateToMiniProgramAppIdList
   *   （微信要求：该列表最多 10 个，且跳转目标需要在提审时声明，未声明会跳转失败）。 */
  externalInvitation: {
    miniprogramName: '',
    appId: '',
  },

  /** 支付平台开关（按终端控制购买入口显隐，页面读 resolvePlatformPurchaseEnabled 决定，
   * 不改页面代码即可开关某终端购买入口——如 iOS 虚拟商品规则变化时先行关闭） */
  payment: {
    platforms: {
      ios: { purchaseEnabled: true },
      android: { purchaseEnabled: true },
    },
    /** 某终端购买入口关闭时，购买页显示的大白话提示（可改文案，不改页面代码） */
    platformDisabledTip: '这台设备上暂时不能购买，会员和积分在其他设备上也能正常用，换台设备试试吧',
  },

  /** 会员防滥用安全上限（用户 2026-10-21 确认口径：会员不设业务额度，
   * 只在后台悄悄设很高的安全上限防滥用；用户平时碰不到，界面不展示） */
  safetyCaps: {
    books: 1000,       // 礼薄总数安全上限
    perBook: 5000,     // 每本礼薄记录数安全上限
    giftRecords: 10000, // 送礼记录安全上限
    contacts: 5000,    // 亲友数安全上限
  },

  /** 邀请奖励额度（用户 2026-10-20 决定：保留并正式开启，不再冻结）
   *
   * 规则摘要：
   * - 成功邀请一人：收礼记录额度 +10（计入用户级"收礼额度池"，所有礼薄合计，
   *   不是每礼薄各加 10，也不增加礼薄个数）；送礼额度 +5
   * - 生效条件：被邀请人是新注册用户、经邀请码绑定邀请关系，并且
   *   新建 ≥1 个礼薄 + ≥1 条收礼记录，或 ≥1 条送礼记录，才算一次成功邀请
   * - 每对（邀请人, 被邀请人）只发放一次，重复触发幂等；被邀请人注销后不重复计
   * - 上限 maxSuccessfulInvites：每个邀请人最多计入的成功邀请次数
   *   （含义按"最多 N 次成功邀请"实现，待用户最终确认）
   * - 数字全部放配置；老板平台可覆盖（appConfig 文档 inviteReward 段）
   * - 合规口径：不得出现强制/诱导分享措辞；不以分享到朋友圈/群聊为条件，
   *   邀请码手动输入同样可以绑定
   */
  inviteReward: {
    enabled: true, // 正式开启（老板平台可关停）
    rules: {
      perInvite: { receivePool: 10, giftRecords: 5 },
      maxSuccessfulInvites: 10, // 每个邀请人最多计入的成功邀请次数（现行上限口径）
      maxInvites: 10, // 旧字段（与 maxSuccessfulInvites 同值，兼容存量读取，新代码读 maxSuccessfulInvites）
      // effectiveWhen: 新用户经邀请码绑定 && (新建≥1礼薄+≥1收礼记录 || ≥1送礼记录)
    },
  },

  /** 家庭共享权限开关（五个；"仅查看"恒开不可取消，"可导出"默认关） */
  shareSwitches: [
    { id: 'view', name: '仅查看', alwaysOn: true, defaultOn: true },
    { id: 'add', name: '可新增', alwaysOn: false, defaultOn: false },
    { id: 'edit', name: '可修改', alwaysOn: false, defaultOn: false },
    { id: 'del', name: '可删除', alwaysOn: false, defaultOn: false },
    { id: 'export', name: '可导出', alwaysOn: false, defaultOn: false },
  ],

  /** 会员专属功能清单（老板平台可调；服务端门禁用）
   * familyShareInvite: 发起家庭共享邀请（须有效会员）
   * photoImport: 拍照导入
   * landscapeMode: 经典红字大写横置礼簿模式
   */

  /** 账号注销（阶段3 + 任务L 全流程）：⚠️ 待用户确认，确认前不上线（enabled 保持 false，
   * 开关关闭时申请入口直接拒绝）；coolingOffDays 为冷静期天数，冷静期内可撤销，期满执行清理 */
  accountCancellation: { enabled: false, coolingOffDays: 7 },

  /** 版本号（"我的—关于我们"读这里；发版时只改这一处） */
  version: 'v0.5.0-dev',

  /** 通知（任务L）：订阅消息模板 ID 占位——云联调时按类型填入公众平台申请的
   * 模板 ID 后，core/notify 的订阅通道自动启用；留空则只走站内通知 */
  notify: {
    subscribeTemplates: {
      membershipExpiring: '',
      membershipExpired: '',
      graceEnding: '',
      inviteRewardGranted: '',
      shareChanged: '',
    },
  },

  /** 意见反馈（任务L）：正文最长字数 */
  feedback: { maxLength: 500 },
  /** 本地演示模式（阶段2 2A）：true=用微信本地存储演示，false=走云开发。
   * 正式发布前必须设为 false，见 docs/发布检查清单。 */
  demo: { localMode: true },

  memberOnlyFeatures: ['familyShareInvite', 'photoImport', 'landscapeMode'],

  /** 全局 UI 规范 */
  ui: {
    addButtonPosition: 'bottom-center', // 红色＋按钮统一放底部中间
    primaryRed: '#E64340',              // 主红（占位，视觉后定）
  },
};

module.exports = AppConfig;
