/**
 * 礼单簿 · 自定义 Tab 栏（任务Z 第 1 项）
 * 用途：送礼/收礼列表页不在原生 tabBar 名单里，进页面后原生栏消失；
 * 本组件与原生栏同款（图标/文字/顺序/配色与 app.json tabBar 保持一致），
 * 点击 switchTab 回四个 Tab 页。这两页自身不属于任何 Tab，selected 传 -1 不高亮任何一项。
 * ⚠️ 图标路径须与 app.json tabBar.list 逐项一致，换图标时两处一起改。
 */
Component({
  properties: {
    // 当前高亮下标（0-3）；-1 = 不高亮（列表页用）
    selected: { type: Number, value: -1 },
  },
  data: {
    items: [
      { pagePath: '/pages/index/index', text: '首页', icon: '/images/tabbar/home.png' },
      { pagePath: '/pages/wanglai/wanglai', text: '往来', icon: '/images/tabbar/wanglai.png' },
      { pagePath: '/pages/contacts/contacts', text: '亲友录', icon: '/images/tabbar/contacts.png' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: '/images/tabbar/mine.png' },
    ],
  },
  methods: {
    onTap(e) {
      const url = e.currentTarget.dataset.path;
      if (url) wx.switchTab({ url });
    },
  },
});
