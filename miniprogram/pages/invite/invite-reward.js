/**
 * 礼单簿 · 邀请新用户得名额（阶段3）
 * 规则读 AppConfig.inviteReward；开关保持关闭；页面显示"暂未开启"。
 * 微信合规核查结论一并展示，交用户决定是否开启。
 */
const AppConfig = require('../../config/app-config.js');

Page({
  data: {
    enabled: false,
    rules: null,
  },

  onLoad() {
    const ir = AppConfig.inviteReward || {};
    this.setData({
      enabled: !!ir.enabled,
      rules: ir.rules || null,
    });
  },
});
