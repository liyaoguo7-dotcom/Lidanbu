/**
 * 老板平台 · 示例截图管理（第9项）
 * 静态清单：列出仓库 docs/screens 的存档截图与产品内示例页素材，
 * 并说明哪些已经上线到示例页。素材替换走代码仓库，本页只做清单核对，
 * 不提供上传（上传通道待云存储联调）。
 */
Page({
  data: {
    groups: [
      {
        title: '产品内示例页（已上线，用户可点开）',
        rows: [
          { name: '收礼示例页', status: '已上线', note: 'pages/example/receive-example，假数据真实页面，收礼空状态「点击查看示例」进入' },
          { name: '送礼示例页', status: '已上线', note: 'pages/example/gift-example，假数据真实页面，送礼空状态「点击查看示例」进入' },
        ],
      },
      {
        title: '主流程页面截图存档（docs/screens/，22 张）',
        rows: [
          { name: 'receive / gifts / wanglai / timeline 等', status: '已存档', note: 'receive.png、wanglai.png、timeline.png、share-*.png、export-*.png、member-home.png、invite.png、invite-reward.png、quota-usage.png、members.png、overview.png、app-config.png、privacy.png、mine-cancel.png、admin-home.png、todo.png 等' },
        ],
      },
      {
        title: '横置礼单本截图存档（docs/screens/landscape/，10 张）',
        rows: [
          { name: '定版图 30、33–39、42、43', status: '已存档', note: '请横屏页、6 种收礼样式、送礼横置、半屏详情、样式面板' },
        ],
      },
      {
        title: '老板平台截图存档（docs/screens/admin/）',
        rows: [
          { name: '15 项各 1 张 + 入口页', status: '已存档', note: '见 docs/screens/admin/README.md 索引，全部为静态复刻存档图' },
        ],
      },
    ],
  },
  onLoad() { wx.setNavigationBarTitle({ title: '示例截图管理' }); },
});
