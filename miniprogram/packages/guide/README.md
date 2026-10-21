# packages/guide · 引导页截图分包（纯资源分包，无页面）

引导页（`miniprogram/pages/guide`）三屏主视觉的成品图，每张 ≤150KB：

- `guide-receive.png`：收礼记录列表（礼薄详情）截图
- `guide-gifts.png`：送礼记录列表截图
- `guide-timeline.png`：往来竖线树截图

不要手工替换这三张图：页面改版后改复刻源并跑
`python3 tools/regen-guide-shots/regen.py` 一键重生成（说明见该目录 README）。
进入首页时经 app.json 的 preloadRule 预下载本分包（未看过引导的新用户
首次进入引导页时也会按需自动下载）。
