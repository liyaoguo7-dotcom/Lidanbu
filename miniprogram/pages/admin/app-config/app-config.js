/**
 * 老板平台 · 配置查看页（阶段5第5/8/13项）
 * ?section=pricing 额度与会员价格设置 / switches 功能开关 / features 会员专属功能清单
 *
 * 本轮为只读展示：所有配置来自 AppConfig（改配置不改代码）。
 * 配置修改走后台，修改将记入操作记录（云函数待联调：管理员身份+二次验证，上线前必须有）。
 */
const AppConfig = require('../../config/app-config.js');

const SECTIONS = {
  pricing: { title: '额度与会员价格设置' },
  switches: { title: '功能开关' },
  features: { title: '会员专属功能清单设置' },
};

Page({
  data: { title: '', section: '', rows: [] },
  onLoad(query) {
    const section = (query && query.section) || 'pricing';
    const meta = SECTIONS[section] || SECTIONS.pricing;
    wx.setNavigationBarTitle({ title: meta.title });
    this.setData({ title: meta.title, section, rows: this.buildRows(section) });
  },
  buildRows(section) {
    if (section === 'pricing') {
      const f = AppConfig.freeQuota || {};
      const q = (AppConfig.membership && AppConfig.membership.quota) || {};
      return [
        { group: '免费额度（当前）' },
        { k: '收礼礼薄', v: `${f.receiveEvents} 个` },
        { k: '每礼薄收礼记录', v: `${f.recordsPerEvent} 条` },
        { k: '送礼记录', v: `${f.giftRecords} 条` },
        { k: '亲友录联系人', v: `${f.contacts} 人` },
        { group: '会员额度（占位，待定价）' },
        { k: '礼薄数', v: `${q.receiveEvents}` },
        { k: '每礼薄记录', v: `${q.recordsPerEvent}` },
        { k: '送礼记录', v: `${q.giftRecords}` },
        { k: '联系人', v: `${q.contacts}` },
        { group: '会员价格档位' },
        { k: '价格', v: '占位，待定（发布前必须填真实价格）' },
      ];
    }
    if (section === 'switches') {
      const mf = (AppConfig.membership && AppConfig.membership.features) || {};
      const ir = AppConfig.inviteReward || {};
      const rows = [{ group: '会员功能开关' }];
      Object.keys(mf).forEach((k) => rows.push({ k, v: mf[k] ? '开' : '关' }));
      rows.push({ group: '其他开关' });
      rows.push({ k: '邀请奖励 inviteReward', v: ir.enabled ? '开' : '关（预留）' });
      (AppConfig.shareSwitches || []).forEach((s) =>
        rows.push({ k: `家庭共享·${s.name}`, v: s.alwaysOn ? '恒开' : (s.defaultOn ? '默认开' : '默认关') })
      );
      return rows;
    }
    // features
    const list = AppConfig.memberOnlyFeatures || [];
    const rows = [{ group: '会员专属功能清单（当前）' }];
    const names = { familyShareInvite: '家庭共享邀请', photoImport: '拍照导入', landscapeMode: '横置红字礼单本' };
    list.forEach((id) => rows.push({ k: names[id] || id, v: '会员专属' }));
    return rows;
  },
});
