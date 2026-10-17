/**
 * 礼单簿 · 应用配置中心
 * v3.1 决策更新版 - 冻结配置项
 *
 * 铁律：Tab 名称、免费额度、10 标签、会员规则一律从这里读取，
 * 不得在页面/组件里写死。后台可调项预留云端覆盖接口（阶段1 接 AppConfig 集合）。
 */

const AppConfig = {
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
    { id: 'jiehun', name: '结婚', icon: 'icon-jiehun' },   // 红双喜（白事不得出现）
    { id: 'shengzi', name: '生子', icon: 'icon-shengzi' },
    { id: 'tanwang', name: '探望', icon: 'icon-tanwang' },
    { id: 'yasui', name: '压岁', icon: 'icon-yasui' },
    { id: 'shengri', name: '生日', icon: 'icon-shengri' },
    { id: 'shengxue', name: '升学', icon: 'icon-shengxue' },
    { id: 'qiaoqian', name: '乔迁', icon: 'icon-qiaoqian' },
    { id: 'dashou', name: '大寿', icon: 'icon-dashou' },
    { id: 'baishi', name: '白事', icon: 'icon-baishi' },
    { id: 'qita', name: '其他', icon: 'icon-qita' },
  ],
  defaultTagId: 'jiehun', // 默认选中"结婚"

  /** 收礼记录类型 */
  recordTypes: ['红包', '现金', '转账', '微信', '支付宝'],

  /** 会员规则（具体数字待定价时再定，此处为占位结构） */
  membership: {
    // 会员专属功能开关
    features: {
      photoImport: true,   // 拍照导入：会员功能
      redLedgerMode: true, // 经典红字大写横置礼簿模式：会员功能
    },
    // 会员额度（数字待定价时一起定；此处为占位，阶段1逻辑按此结构读取）
    quota: {
      receiveEvents: 30,     // 会员：礼薄数（占位，待定）
      recordsPerEvent: 500,  // 会员：每礼薄记录数（占位，待定）
      giftRecords: 500,      // 会员：送礼记录数（占位，待定）
      contacts: 500,         // 会员：联系人数（占位，待定）
    },
    // 会员到期规则（v3.1 已确认）
    expiry: {
      gracePeriodDays: 90,       // 缓冲期约 90 天
      reminders: [15, 0, -1],    // 到期前15天、到期当天、缓冲期结束前各提醒一次（-1=结束前）
      overQuotaReadonly: true,   // 超出免费额度的记录变为只读（可查可导出，不能改、不能新增）
    },
  },

  /** 邀请奖励额度（预留：规则用户 2026-10-18 已确认，功能未开发，当前不启用）
   *
   * 规则摘要：
   * - 成功邀请一人：收礼记录额度 +10（计入用户级"收礼额度池"，所有礼薄合计，
   *   不是每礼薄各加 10，也不增加礼薄个数）；送礼额度 +5
   * - 生效条件：新用户通过邀请进入，并且新建了一个礼薄+一个收礼联系人，
   *   或者一个送礼联系人，才算一次成功邀请；被邀请人为普通用户
   * - 上限："每个用户 10 个上限"含义待用户确认，先按最多 10 个成功邀请预留
   * - 数字全部放配置
   */
  inviteReward: {
    enabled: false, // 预留开关：当前关闭，getInviteRewardQuota 固定返回 0
    rules: {
      perInvite: { receivePool: 10, giftRecords: 5 },
      maxInvites: 10, // 含义待确认，先按最多 10 个成功邀请预留
      // effectiveWhen: 新用户经邀请进入 && (新建1礼薄+1收礼联系人 || 1送礼联系人)（待实现）
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

  /** 全局 UI 规范 */
  ui: {
    addButtonPosition: 'bottom-center', // 红色＋按钮统一放底部中间
    primaryRed: '#E64340',              // 主红（占位，视觉后定）
  },
};

module.exports = AppConfig;
