/**
 * 礼单簿 · 隐私协议同意弹窗（任务Q2，页面层）
 * 首次打开小程序时由首页弹出：同意后才调用需要隐私授权的接口
 * （选头像、拍照导入）；不同意不拦浏览，只显示委婉说明、核心记账照常只读查看。
 * 属性：show 是否显示
 * 事件：agree() 点「同意」；disagree() 点「不同意」；
 *       privacy() 点《隐私政策》链接；agreement() 点《用户协议》链接
 *       （链接跳转由页面处理，弹窗本身不导航）
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
  },
  methods: {
    onAgree() {
      this.triggerEvent('agree');
    },
    onDisagree() {
      this.triggerEvent('disagree');
    },
    onPrivacy() {
      this.triggerEvent('privacy');
    },
    onAgreement() {
      this.triggerEvent('agreement');
    },
    // 阻止遮罩下层滚动穿透
    noop() {},
  },
});
