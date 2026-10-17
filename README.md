# 礼单簿微信小程序

> 阶段 0 工程骨架（T0.1）。需求基线：《礼单簿小程序产品需求文档 v3.1 决策更新版》。

## 技术栈

- 微信小程序原生 + 微信云开发（云函数 / 云数据库 / 云存储）
- AppID：待用户提供（当前用 `touristappid` 占位，可在开发者工具直接打开预览结构）

## 目录结构

```
Lidanbu/
├── miniprogram/            # 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── config/app-config.js  # 配置中心：Tab名、免费额度、10标签、会员规则、共享开关（不得写死）
│   ├── pages/
│   │   ├── index/    # 首页（T0.1 占位）
│   │   ├── wanglai/  # 往来 Tab2（名称从配置读，暂定"往来"）
│   │   ├── contacts/ # 亲友录（T0.1 占位）
│   │   ├── mine/     # 我的（T0.1 占位）
│   │   └── demo/     # 组件示例页（T0.2 用）
│   ├── components/         # 通用组件（T0.2 用）
│   └── utils/              # 工具函数
├── cloudfunctions/         # 云函数（阶段1 用）
├── docs/                   # 文档
├── project.config.json     # 项目配置（AppID 占位 touristappid）
└── .gitignore
```

## 配置说明

所有业务数字从 `miniprogram/config/app-config.js` 读取：
- 底部 Tab（含 Tab2 暂定名"往来"）：`tabs`
- 免费额度（3 礼薄 / 30 条每礼薄 / 30 条送礼 / 50 联系人）：`freeQuota`
- 10 标签（收礼送礼共用）：`tags`
- 会员规则、5 个共享开关：`membership` / `shareSwitches`

`app.js` 启动时用 `wx.setTabBarItem` 把 Tab2 名称从配置写入 tabBar，`app.json` 里不写死。

## 本地运行

1. 微信开发者工具 → 导入项目 → 选择本目录
2. AppID 栏可先用测试号（`touristappid` 已预填为占位）
3. 云开发环境 ID 待用户提供后填入 `app.js` 的 `cloudEnvId`（或在云开发控制台开通后配置）

## 提交规范（T0.5）

- 每完成一个任务提交一次
- 提交说明格式：`T0.x <任务名>：<改了什么>`
- 绝不提交密钥、密码、AppSecret、私有配置
