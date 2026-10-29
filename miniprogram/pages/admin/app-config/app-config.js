/**
 * 老板平台 · 配置编辑页（第5/8/13项）
 * ?section=pricing 额度与会员价格设置 / switches 功能开关（开关中心：总开关·会员功能·支付开关三组（AM批定版））
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
  points: { title: '会员与积分配置' },
};
const QUOTA_FIELDS = [
  { key: 'receiveEvents', label: '收礼礼薄（个）' },
  { key: 'recordsPerEvent', label: '每礼薄收礼记录（条）' },
  { key: 'giftRecords', label: '送礼记录（条）' },
  { key: 'contacts', label: '亲友录联系人（人）' },
];
const FEATURE_FIELDS = [
  { key: 'familyShareInvite', label: '家庭共享邀请' },
  { key: 'photoImport', label: '拍照导入' },
  { key: 'landscapeMode', label: '横置红字礼单本' },
];

Page({
  data: {
    title: '', section: 'pricing', loading: true, error: '',
    quotaFields: QUOTA_FIELDS, featureFields: FEATURE_FIELDS,
    freeQuota: {}, memberQuota: {}, plans: [], memberOnly: [],
    pricingFromStatic: false, saving: false,
    pointsCfg: { registerGrant: '', photoImportCost: '' }, packs: [],
    platforms: { ios: true, android: true },
    launch: { paymentEnabled: false, photoImportEnabled: false },
    gates: { eInvitation: true, familyShare: true, maintenance: false, registration: true, landscape: true }, // 总开关组（在「功能开关」页总开关组保存）
    featureChecked: {}, // 会员专属清单的勾选映射（WXML 不能调 .indexOf()，须 JS 预先算好）
  },

  async onLoad(query) {
    const section = (query && query.section) || 'pricing';
    const meta = SECTIONS[section] || SECTIONS.pricing;
    wx.setNavigationBarTitle({ title: meta.title });
    this.setData({ title: meta.title, section });
    try {
      const cfg = await ds.adminGetConfig();
      const planView = (p) => {
        // 档位额度（2026-10-25）：落库档位没配额度时回落静态同 id 档位的额度展示，避免打开即空白保存被拦
        const sq = ((AppConfig.pricing || []).find((x) => x.id === p.id) || {}).quota || {};
        const q = p.quota || sq;
        return {
          id: p.id, name: p.name, yuan: formatAmount(p.priceFen), days: String(p.days),
          androidYuan: formatAmount(p.androidPriceFen !== undefined ? p.androidPriceFen : p.priceFen),
          iosYuan: formatAmount(p.iosPriceFen !== undefined ? p.iosPriceFen : p.priceFen),
          grantPoints: String(p.grantPoints || 0), recommended: !!p.recommended, onShelf: p.onShelf !== false,
          qEvents: String(q.receiveEvents !== undefined ? q.receiveEvents : ''),
          qPerEvent: String(q.recordsPerEvent !== undefined ? q.recordsPerEvent : ''),
          qGifts: String(q.giftRecords !== undefined ? q.giftRecords : ''),
          qContacts: String(q.contacts !== undefined ? q.contacts : ''),
        };
      };
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
        memberOnly: [...(cfg.memberOnlyFeatures || [])],
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
        gates: {
          eInvitation: cfg.eInvitationEnabled !== false,
          familyShare: cfg.familyShareEnabled !== false,
          maintenance: cfg.maintenanceEnabled === true,
          registration: cfg.registrationEnabled !== false,
          landscape: cfg.landscapeEnabled !== false,
        },
        featureChecked: Object.fromEntries(FEATURE_FIELDS.map((f) => [f.key, (cfg.memberOnlyFeatures || []).includes(f.key)])),
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
      androidYuan: '1.00', iosYuan: '1.00',
      grantPoints: '0', recommended: false, onShelf: true,
      qEvents: '30', qPerEvent: '500', qGifts: '500', qContacts: '500',
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
  /** 会员功能开关（AM批改名，原「会员专属功能」）；只动本组名单，保存走 onSaveFeatures */
  onMemberSwitch(e) {
    const key = e.currentTarget.dataset.key;
    const on = !!e.detail.value;
    const memberOnly = on
      ? [...new Set([...this.data.memberOnly, key])]
      : this.data.memberOnly.filter((f) => f !== key);
    this.setData({ memberOnly, [`featureChecked.${key}`]: on });
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
        // DJ批：分平台价（留空=跟现价；填了必须合法，购买仍走现价、换真适配器时再按渠道选价）
        const androidPriceFen = p.androidYuan ? yuanToFen(p.androidYuan) : priceFen;
        if (androidPriceFen === null) throw new Error(`第 ${i + 1} 个档位安卓价不正确`);
        const iosPriceFen = p.iosYuan ? yuanToFen(p.iosYuan) : priceFen;
        if (iosPriceFen === null) throw new Error(`第 ${i + 1} 个档位苹果价不正确`);
        const days = Number(p.days);
        if (!Number.isInteger(days) || days < 1) throw new Error(`第 ${i + 1} 个档位天数不正确`);
        const grantPoints = Number(p.grantPoints);
        if (!Number.isInteger(grantPoints) || grantPoints < 0) throw new Error(`第 ${i + 1} 个档位赠送积分不正确`);
        const qn = (v, label) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0) throw new Error(`第 ${i + 1} 个档位${label}不正确`);
          return n;
        };
        return {
          id: p.id, name: p.name.trim(), priceFen, days, grantPoints,
          androidPriceFen, iosPriceFen,
          recommended: !!p.recommended, onShelf: p.onShelf !== false,
          quota: {
            receiveEvents: qn(p.qEvents, '额度·礼薄数'),
            recordsPerEvent: qn(p.qPerEvent, '额度·每礼薄条数'),
            giftRecords: qn(p.qGifts, '额度·送礼条数'),
            contacts: qn(p.qContacts, '额度·联系人数'),
          },
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

  onSaveFeatures() {
    const features = [...this.data.memberOnly];
    this.confirmSave('会员功能', () => ds.adminUpdateMemberOnlyFeatures(features));
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
  // —— 支付开关组保存（AM批：云端购买与支付平台放一组，一个保存）——
  // 云端购买写 payment 段、平台入口写 paymentPlatforms 段，两次调用各写各段不串。
  onSavePayment() {
    const paymentEnabled = !!this.data.launch.paymentEnabled;
    const platforms = {
      ios: { purchaseEnabled: !!this.data.platforms.ios },
      android: { purchaseEnabled: !!this.data.platforms.android },
    };
    this.confirmSave('支付开关', async () => {
      await ds.adminUpdateLaunchSwitches({ paymentEnabled });
      await ds.adminUpdatePaymentPlatforms(platforms);
    });
  },

  // —— 第一版发布开关（任务AF） ——
  onLaunchToggle(e) {
    this.setData({ [`launch.${e.currentTarget.dataset.key}`]: e.detail.value });
  },
  // —— 总开关组保存（AL-7）：只写总开关六闸，各组保存各管各的 ——
  onSaveMaster() {
    const switches = {
      photoImportEnabled: !!this.data.launch.photoImportEnabled,
      eInvitationEnabled: !!this.data.gates.eInvitation,
      familyShareEnabled: !!this.data.gates.familyShare,
      maintenanceEnabled: !!this.data.gates.maintenance,
      registrationEnabled: !!this.data.gates.registration,
      landscapeEnabled: !!this.data.gates.landscape,
    };
    this.confirmSave('总开关', () => ds.adminUpdateLaunchSwitches(switches));
  },
});
