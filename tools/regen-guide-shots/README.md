# 引导页截图重生成

引导页（`miniprogram/pages/guide`）的三屏主视觉是真实页面的静态复刻截图，
不是随手拍的图。页面改版后按下面三步一键重出：

1. 改复刻源：`docs/screens/guide-assets-src/` 下的 `receive-records.html`（收礼记录列表）、
   `gifts.html`（送礼列表）、`timeline.html`（往来竖线树）。数据口径与金额格式
   写在每个 HTML 的头部注释里（演示种子同口径，改版时同步核对真实页面 wxml/wxss）。
2. 跑脚本：`python3 tools/regen-guide-shots/regen.py`
3. 脚本自动：CDP 整页截图（390 逻辑宽、2 倍图）→ 源图存档在 `guide-assets-src/*.png`
   → 压缩（宽 750 起、256 色量化，单张 ≤150KB，超限自动收窄、到 600 宽仍超限则报错退出）
   → 成品落位 `miniprogram/images/guide/guide-*.png` → 顺带重出汇报存档图
   `docs/screens/guide-new-1/2/3.png`。终端会逐张打印体积与是否达标。

依赖：`/opt/meta-chromium/chrome`、python3 的 `websocket-client` 与 `PIL`。
