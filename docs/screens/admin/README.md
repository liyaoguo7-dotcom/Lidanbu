# docs/screens/admin/

老板平台全部页面截图（16 张），与 `docs/screens/` 同法：**静态复刻渲染，非真机截图，仅用于版式存档**。
复刻源文件在 `src/`（按各页面 wxml/wxss/js 做 HTML 复刻，375px 宽 CDP 截图，@2x）。
示例数据为脱敏占位（用户号均为 `oAb***9zQ` 式脱敏，数字为占位示例），不代表真实数据。

**任务M（收官轮）后 15 项全部接真接口**，原骨架页截图（todo-*.png）已删除并按真页面重出。

| 文件 | 对应页面 | 状态 |
|---|---|---|
| admin-home.png | 老板平台入口（15 项列表） | 真页面 |
| overview.png | 1 数据概览 | 真数据页（core/admin.overview） |
| members.png | 2 会员管理 | 真数据页（core/admin.memberList / setMemberPlan） |
| account.png | 3 账号查询 | 真数据页（core/admin.searchAccounts，按编号片段/注册时间段，只回条数汇总） |
| photo-usage.png | 4 拍照导入用量监控 | 真数据页（core/admin.importUsage，ImportJob 按日/周聚合） |
| app-config-pricing.png | 5 额度与会员价格设置 | 可编辑页（core/admin.updateQuotaSettings / updatePricing，二次确认+审计） |
| feedback.png | 6 用户反馈列表 | 真数据页（core/admin.feedbackList / feedbackSetStatus） |
| orders.png | 7 会员订单与收入 | 真数据页（core/admin.orderList / orderStats，接 orders 集合） |
| app-config-switches.png | 8 功能开关 | 可编辑页（core/admin.updateFeatureSwitches） |
| screenshots.png | 9 示例截图管理 | 静态清单页（示例页素材与存档截图清单） |
| admins.png | 10 管理员账号、权限与操作记录 | 真数据页（core/admin.listAdmins 只读 + auditTrail） |
| abuse.png | 11 异常用户限制 | 真操作页（core/admin.setUserRestricted，写入口由 core/restriction 拦截） |
| quota-usage.png | 12 用户额度使用情况 | 真数据页（core/admin.quotaUsage） |
| app-config-features.png | 13 会员专属功能清单设置 | 可编辑页（core/admin.updateMemberOnlyFeatures） |
| invite.png | 14 邀请奖励设置与数据 | 真数据页（core/admin.inviteStats / updateInviteSettings） |
| share-overview.png | 15 家庭共享概况 | 真数据页（core/admin.shareOverview） |

任务P2 新增：`../admin-points-config.png`（存 docs/screens/ 根目录）——16/17 项「会员与积分配置」「支付平台开关」的合并存档图（app-config 的 points/platforms 两分区），复刻源在本目录 `src/app-config-points.html`。

铁律：所有页面只看统计数字与会员状态，不含任何礼金、联系人、备注内容；用户号一律脱敏。
新增接口一律在 core 侧校验管理员身份（appConfig 文档 adminIds），页面拿不到数据即报错提示。
