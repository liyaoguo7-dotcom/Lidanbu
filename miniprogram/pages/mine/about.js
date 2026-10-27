/**
 * 礼单簿 · 关于我们（任务L）
 * 版本号读配置中心（AppConfig.version）；字体授权署名与横置页口径一致。
 */
const AppConfig = require('../../config/app-config.js');

Page({
  data: {
    version: AppConfig.version || '',
    fontCredit: '横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体、枝芒行书、古典宋体、莫大毛笔（SIL OFL 1.1）',
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onGuide() {
    // 重看模式（from=about）：右上角是「关闭」，不改"已看"标记
    wx.navigateTo({ url: '/pages/guide/guide?from=about' });
  },

  onAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },
});
