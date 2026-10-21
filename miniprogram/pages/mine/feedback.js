/**
 * 礼单簿 · 意见反馈（任务L）
 * 文字必填（上限读配置 AppConfig.feedback.maxLength）；截图可选，最多 3 张。
 * 截图本轮只存本地占位路径：云联调后改为先上传云存储、再把 fileID 提交，
 * 提交接口（data-service.submitFeedback）不变。
 */
const dataService = require('../../../services/data-service.js');
const AppConfig = require('../../../config/app-config.js');

const MAX_IMAGES = 3;

Page({
  data: {
    content: '',
    images: [],
    maxLength: (AppConfig.feedback && AppConfig.feedback.maxLength) || 500,
    maxImages: MAX_IMAGES,
    submitting: false,
  },

  onInput(e) {
    this.setData({ content: e.detail.value });
  },

  /** 选截图（占位）：云联调后此处先上传云存储换 fileID 再入列 */
  onAddImage() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多附 ${MAX_IMAGES} 张截图`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
        this.setData({ images: this.data.images.concat(paths).slice(0, MAX_IMAGES) });
      },
    });
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const images = this.data.images.slice();
    images.splice(idx, 1);
    this.setData({ images });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const content = (this.data.content || '').trim();
    if (!content) {
      wx.showToast({ title: '先写下你想说的话吧', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await dataService.submitFeedback({ content, images: this.data.images });
      wx.showToast({ title: '收到啦，谢谢你的反馈', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      wx.showToast({ title: e.message || '提交失败，请重试', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});
