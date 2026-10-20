# docs/screens/admin/

老板平台全部页面截图（16 张），与 `docs/screens/` 同法：**静态复刻渲染，非真机截图，仅用于版式存档**。
复刻源文件在 `src/`（按各页面 wxml/wxss/js 做 HTML 复刻，375px 宽 CDP 截图，@2x）。
示例数据为脱敏占位（用户号均为 `oAb***9zQ` 式脱敏，数字为占位示例），不代表真实数据。

| 文件 | 对应页面 | 状态 |
|---|---|---|
| admin-home.png | 老板平台入口（15 项列表） | 真页面 |
| overview.png | 1 数据概览 | 真数据页（core/admin.overview） |
| members.png | 2 会员管理 | 真数据页（core/admin.memberList） |
| todo-account.png | 3 账号查询 | 骨架（黄条，结构已补全） |
| todo-photo.png | 4 拍照导入用量监控 | 骨架（黄条，结构已补全） |
| app-config-pricing.png | 5 额度与会员价格设置 | 配置页只读展示（写接口在 core，页面编辑待云联调） |
| todo-feedback.png | 6 用户反馈列表 | 骨架（黄条，结构已补全） |
| todo-orders.png | 7 会员订单与收入 | 骨架（黄条，结构已补全） |
| app-config-switches.png | 8 功能开关 | 配置页只读展示（写接口在 core，页面编辑待云联调） |
| todo-screenshots.png | 9 示例截图管理 | 骨架（黄条，结构已补全） |
| todo-admins.png | 10 管理员账号、权限与操作记录 | 骨架（黄条，结构已补全；服务端审计已在写） |
| todo-abuse.png | 11 异常用户限制 | 骨架（黄条，结构已补全） |
| quota-usage.png | 12 用户额度使用情况 | 真数据页（core/admin.quotaUsage） |
| app-config-features.png | 13 会员专属功能清单设置 | 配置页只读展示（写接口在 core，页面编辑待云联调） |
| invite.png | 14 邀请奖励设置与数据 | 真数据页（core/admin.inviteStats） |
| share-overview.png | 15 家庭共享概况 | 真数据页（core/admin.shareOverview） |

铁律：所有页面只看统计数字与会员状态，不含任何礼金、联系人、备注内容；用户号一律脱敏。
