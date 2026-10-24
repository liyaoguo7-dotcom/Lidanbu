/**
 * 老板平台 · 配置编辑页（第5/8/13项）
 * ?section=pricing 额度与会员价格设置 / switches 功能开关 / features 会员专属功能清单
 *
 * 页面内直接编辑、保存落库：全部走 core.admin 写接口（管理员校验在 core），
 * 保存前二次确认，每次修改写操作记录（审计）。价格只从配置读，页面不写死。
 */
const ds = require('../../../services/data-service.js');
const AppConfig = require('../../../config/app-config.js');
const { formatAmount } = require('../../../core/format.js');

/** 元字符串 → 分（整数）：不用浮点除法，与全站金额口径一致 */
function yuanToFen(str) {
  const s = String(str || '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const parts = s.split('.');
  const yuan = parseInt(parts[0], 10);
  const fen = parseInt(((parts[1] || '') + '00').slice(0, 2), 10);
  return yuan * 100 + fen;
}

const SECTIONS = {
  pricing: { title: '额度与会员价格设置' },
  switches: { title: '功能开关' },
  features: { title: '会员专属功能清单设置' },
  points: { title: '会员与积分配置' },
  platforms: { title: '支付平台开关' },
};
const QUOTA_FIELDS = [
  { key: 'receiveEvents', label: '收礼礼薄（个）' },
  { key: 'recordsPerEvent', label: '每礼薄收礼记录（条）' },
  { key: 'giftRecords', label: '送礼记录（条）' },
  { key: 'contacts', label: '亲友录联系人（人）' },
];
const SWITCH_FIELDS = [
  { key: 'photoImport', label: '拍照导入' },
  { key: 'redLedgerMode', label: '横置红字礼单本' },
];
const FEATURE_FIELDS = [
  { key: 'familyShareInvite', label: '家庭共享邀请' },
  { key: 'photoImport', label: '拍照导入' },
  { key: 'landscapeMode', label: '横置红字礼单本' },
];

Page({
  data: {
    title: '', section: 'pricing', loading: true, error: '',
    quotaFields: QUOTA_FIELDS, switchFields: SWITCH_FIELDS, featureFields: FEATURE_FIELDS,
    freeQuota: {}, memberQuota: {}, plans: [], features: {}, memberOnly: [],
    pricingFromStatic: false, saving: false,
    pointsCfg: { registerGrant: '', photoImportCost: '' }, packs: [],
    platforms: { ios: true, android: true },
    launch: { paymentEnabled: false, photoImportEnabled: false },
  },

  async onLoad(query) {
    const section = (query && query.section) || 'pricing';
    const meta = SECTIONS[section] || SECTIONS.pricing;
    wx.setNavigationBarTitle({ title: meta.title });
    this.setData({ title: meta.title, section });
    try {
      const cfg = await ds.adminGetConfig();
      const planView = (p) => ({
        id: p.id, name: p.name, yuan: formatAmount(p.priceFen), days: String(p.days),
        grantPoints: String(p.grantPoints || 0), recommended: !!p.recommended, onShelf: p.onShelf !== false,
      });
      let plans = (cfg.pricing || []).map(planView);
      let pricingFromStatic = false;
      if (plans.length === 0) {
        // 平台未落库时先展示静态占位档；保存后即以平台配置为准
        plans = (AppConfig.pricing || []).map(planView);
        pricingFromStatic = true;
      }
      const pts = cfg.points || {};
      const pf = cfg.paymentPlatforms || {};
      this.setData({
        freeQuota: { ...cfg.freeQuota }, memberQuota: { ...cfg.memberQuota },
        features: { ...cfg.membershipFeatures }, memberOnly: [...(cfg.memberOnlyFeatures || [])],
        plans, pricingFromStatic, loading: false,
        pointsCfg: {
          registerGrant: String(pts.registerGrant !== undefined ? pts.registerGrant : ''),
          photoImportCost: String(pts.photoImportCost !== undefined ? pts.photoImportCost : ''),
        },
        packs: (pts.packs || []).map((p) => ({
          id: p.id, name: p.name, yuan: formatAmount(p.priceFen), points: String(p.points),
        })),
        platforms: {
          ios: !pf.ios || pf.ios.purchaseEnabled !== false,
          android: !pf.android || pf.android.purchaseEnabled !== false,
        },
        launch: {
          paymentEnabled: cfg.paymentEnabled === true,
          photoImportEnabled: cfg.photoImportEnabled === true,
        },
      });
    } catch (e) {
      this.setData({ loading: false, error: ds.friendly(e) });
    }
  },

  onQuotaInput(e) {
    const { group, key } = e.currentTarget.dataset;
    this.setData({ [`${group}.${key}`]: e.detail.value });
  },
  onPlanInput(e) {
    const { idx, field } = e.currentTarget.dataset;
    this.setData({ [`plans[${idx}].${field}`]: e.detail.value });
  },
  onAddPlan() {
    const plans = [...this.data.plans, {
      id: `plan${Date.now().toString(36)}`, name: '新档位', yuan: '1.00', days: '30',
      grantPoints: '0', recommended: false, onShelf: true,
    }];
    this.setData({ plans });
  },
  onPlanToggle(e) {
    const { idx, field } = e.currentTarget.dataset;
    this.setData({ [`plans[${idx}].${field}`]: e.detail.value });
  },
  onDelPlan(e) {
    const plans = this.data.plans.filter((_, i) => i !== Number(e.currentTarget.dataset.idx));
    this.setData({ plans });
  },
  onSwitchToggle(e) {
    this.setData({ [`features.${e.currentTarget.dataset.key}`]: e.detail.value });
  },
  onFeatureCheck(e) {
    this.setData({ memberOnly: e.detail.value });
  },

  confirmSave(what, fn) {
    wx.showModal({
      title: '确认保存',
      content: `${what}保存后立即生效，并记入操作记录，确定吗？`,
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ saving: true });
        try {
          await fn();
          wx.showToast({ title: '已保存，已记入操作记录', icon: 'none' });
        } catch (e) {
          wx.showToast({ title: ds.friendly(e), icon: 'none' });
        }
        this.setData({ saving: false });
      },
    });
  },

  num(v, label) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${label}必须是 0 或正整数`);
    return n;
  },

  onSavePricing() {
    let freeQuota; let memberQuota; let plans;
    try {
      freeQuota = {}; memberQuota = {};
      for (const f of QUOTA_FIELDS) {
        freeQuota[f.key] = this.num(this.data.freeQuota[f.key], `免费额度·${f.label}`);
        memberQuota[f.key] = this.num(this.data.memberQuota[f.key], `会员额度·${f.label}`);
      }
      plans = this.data.plans.map((p, i) => {
        const priceFen = yuanToFen(p.yuan);
        if (!p.name.trim()) throw new Error(`第 ${i + 1} 个档位名称不能为空`);
        if (priceFen === null) throw new Error(`第 ${i + 1} 个档位价格不正确`);
        const days = Number(p.days);
        if (!Number.isInteger(days) || days < 1) throw new Error(`第 ${i + 1} 个档位天数不正确`);
        const grantPoints = Number(p.grantPoints);
        if (!Number.isInteger(grantPoints) || grantPoints < 0) throw new Error(`第 ${i + 1} 个档位赠送积分不正确`);
        return {
          id: p.id, name: p.name.trim(), priceFen, days, grantPoints,
          recommended: !!p.recommended, onShelf: p.onShelf !== false,
        };
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      return;
    }
    this.confirmSave('额度与价格', async () => {
      await ds.adminUpdateQuotaSettings({ freeQuota, memberQuota });
      await ds.adminUpdatePricing(plans);
      this.setData({ pricingFromStatic: false });
    });
  },

  onSaveSwitches() {
    const features = {};
    for (const f of SWITCH_FIELDS) features[f.key] = !!this.data.features[f.key];
    this.confirmSave('功能开关', () => ds.adminUpdateFeatureSwitches(features));
  },

  onSaveFeatures() {
    const features = [...this.data.memberOnly];
    this.confirmSave('会员专属功能清单', () => ds.adminUpdateMemberOnlyFeatures(features));
  },

  // —— 积分规则（任务P2） ——
  onPointsInput(e) {
    this.setData({ [`pointsCfg.${e.currentTarget.dataset.key}`]: e.detail.value });
  },
  onPackInput(e) {
    const { idx, field } = e.currentTarget.dataset;
    this.setData({ [`packs[${idx}].${field}`]: e.detail.value });
  },
  onAddPack() {
    const packs = [...this.data.packs, {
      id: `pack${Date.now().toString(36)}`, name: '积分包', yuan: '5.00', points: '5',
    }];
    this.setData({ packs });
  },
  onDelPack(e) {
    const packs = this.data.packs.filter((_, i) => i !== Number(e.currentTarget.dataset.idx));
    this.setData({ packs });
  },
  onSavePoints() {
    let payload;
    try {
      const registerGrant = this.num(this.data.pointsCfg.registerGrant, '注册赠送积分');
      const photoImportCost = this.num(this.data.pointsCfg.photoImportCost, '拍照录入单价');
      const packs = this.data.packs.map((p, i) => {
        const priceFen = yuanToFen(p.yuan);
        if (!p.name.trim()) throw new Error(`第 ${i + 1} 个礼包名称不能为空`);
        if (priceFen === null) throw new Error(`第 ${i + 1} 个礼包价格不正确`);
        const pts = Number(p.points);
        if (!Number.isInteger(pts) || pts < 1) throw new Error(`第 ${i + 1} 个礼包积分不正确`);
        return { id: p.id, name: p.name.trim(), priceFen, points: pts };
      });
      payload = { registerGrant, photoImportCost, packs };
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      return;
    }
    this.confirmSave('积分规则', () => ds.adminUpdatePointsSettings(payload));
  },

  // —— 支付平台开关（任务P2） ——
  onPlatformToggle(e) {
    this.setData({ [`platforms.${e.currentTarget.dataset.key}`]: e.detail.value });
  },
  onSavePlatforms() {
    const platforms = {
      ios: { purchaseEnabled: !!this.data.platforms.ios },
      android: { purchaseEnabled: !!this.data.platforms.android },
    };
    this.confirmSave('支付平台开关', () => ds.adminUpdatePaymentPlatforms(platforms));
  },

  // —— 第一版发布开关（任务AF） ——
  onLaunchToggle(e) {
    this.setData({ [`launch.${e.currentTarget.dataset.key}`]: e.detail.value });
  },
  onSaveLaunch() {
    const switches = {
      paymentEnabled: !!this.data.launch.paymentEnabled,
      photoImportEnabled: !!this.data.launch.photoImportEnabled,
    };
    this.confirmSave('发布开关', () => ds.adminUpdateLaunchSwitches(switches));
  },
});
