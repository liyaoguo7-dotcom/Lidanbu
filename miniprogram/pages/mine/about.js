/**
 * 礼单簿 · 关于我们（任务L）
 * 版本号读配置中心（AppConfig.version）；字体授权署名与横置页口径一致。
 */
const AppConfig = require('../../../config/app-config.js');

Page({
  data: {
    version: AppConfig.version || '',
    fontCredit: '横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体（SIL OFL 1.1）',
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onAgreement() {
    // 用户协议全文为 docs/legal/用户协议.md（发布前法务审定的终稿随版本内置）
    wx.showToast({ title: '用户协议将在正式版中提供', icon: 'none' });
  },
});
