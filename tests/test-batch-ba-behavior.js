/**
 * BA批断言（2026-10-27，用户验上一版包后逐条报的问题＋竞品短视频参照）：
 * ① 顶条按视频复刻：白胶囊条贴标题行（左 12px、右让胶囊、高 32px）、
 *    logo 图＋「人情礼单簿 小程序提供服务」单行、无 ×、横向展开动画；
 * ② 我的页引导按视频复刻：红幅顶边小三角对准胶囊、教程层三行序号步骤
 *    （···／橙色四点图标）＋深藏青「我的小程序」面板卡＋红胶囊按钮，
 *    旧 CSS 迷你界面示意删除；
 * ③ 往来页整页 100vh flex：上半固定、联系人列表进 scroll-view 独立滚动；
 * ④ 横置样式面板：6 个样式选项两排整排居中；
 * ⑤ 核对页：记录间分隔线 #E8E8E8＋上下留白；「全部确认导入」进不透明
 *    白色底栏、按钮纯主红实心，滚动内容不透出。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const rd = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('BA-1 顶条按竞品视频复刻：贴胶囊行白胶囊条、logo+单行文案、无×、横向展开', () => {
  const wxml = rd('miniprogram/components/top-banner/top-banner.wxml');
  const wxss = rd('miniprogram/components/top-banner/top-banner.wxss');
  const js = rd('miniprogram/components/top-banner/top-banner.js');
  // 文案与 logo（无书名号、无红圆盘红包图标）
  assert(wxml.includes('人情礼单簿 小程序提供服务'), '顶条文案应为「人情礼单簿 小程序提供服务」');
  assert(!wxml.includes('『'), '顶条文案不得带书名号');
  assert(wxml.includes('/images/logo.png'), '顶条应放 logo 图');
  assert(!wxml.includes('hongbao.svg'), '顶条不得再用红圆盘红包图标');
  // 无 × 关闭按钮及逻辑
  assert(!wxml.includes('tb-close') && !wxml.includes('onClose'), '顶条 wxml 不得有 × 关闭');
  assert(!js.includes('onClose'), '顶条 js 不得保留 onClose 关闭逻辑');
  assert(!wxss.includes('.tb-close'), '顶条 wxss 不得保留关闭按钮样式');
  // 贴标题行：左 12px、高 32px、圆角白底
  assert(wxss.includes('left: 12px'), '顶条左缘距屏左 12px');
  assert(/\.top-banner\s*\{[^}]*height: 32px/.test(wxss), '顶条高 32px 约等于胶囊高');
  assert(/\.top-banner\s*\{[^}]*background: #FFFFFF/.test(wxss), '顶条白底');
  assert(/\.top-banner\s*\{[^}]*border-radius: 999px/.test(wxss), '顶条全圆角');
  // 横向展开动画：origin 右侧、scaleX、过渡 .3s；停留约 4 秒
  assert(wxss.includes('transform-origin: right'), '展开动画应以右侧为原点（胶囊一侧）');
  assert(wxss.includes('scaleX(0)') && wxss.includes('scaleX(1)'), '展开动画应走 scaleX 0→1');
  assert(wxss.includes('transition: transform .3s'), '展开过渡约 300ms');
  assert(js.includes('4000'), '展开后停留约 4 秒再收起');
  // 定位仍走胶囊实测＋右缘让开胶囊 8px；出现规则（周期 tick）不变、无 storage
  assert(js.includes('getMenuButtonBoundingClientRect'), '顶条定位应读胶囊实测位置');
  assert(js.includes('topBannerShownTick'), '出现规则保持 App 前台化周期 tick');
  assert(!js.includes('StorageSync'), '顶条不得读写任何 storage 标记');
  // logo 资产在位
  assert(fs.existsSync(path.join(__dirname, '..', 'miniprogram/images/logo.png')), 'logo 资产应存在');
});

test('BA-2 我的页引导按竞品视频复刻：红幅小三角+教程层步骤与面板卡', () => {
  const wxml = rd('miniprogram/pages/mine/mine.wxml');
  const wxss = rd('miniprogram/pages/mine/mine.wxss');
  const js = rd('miniprogram/pages/mine/mine.js');
  // 红幅：小三角（偏移由 JS 按胶囊实测写入）＋文案单行＋圆角 8px
  assert(wxml.includes('addmp-tri') && wxml.includes('addMpTriRight'), '红幅应带小三角且 right 由实测写入');
  assert(js.includes('_measureAddMpTri') && js.includes('getMenuButtonBoundingClientRect'), '小三角偏移应按胶囊实测算');
  assert(/\.addmp-bar\s*\{[^}]*border-radius: 8px/.test(wxss), '红幅圆角 8px');
  assert(/\.addmp-tri\s*\{[^}]*background: #F0575A/.test(wxss), '小三角与红幅同色');
  // 教程层：三行序号步骤（第 1 步 ···、第 2 步橙色四点图标）
  assert(wxml.includes('点击屏幕右上角三个点') && wxml.includes('addmp-dots'), '第 1 步应带 ··· 字形');
  assert(wxml.includes('addmp-grid-icon') && wxml.includes('点击 「添加到我的小程序」'), '第 2 步文字前应有橙色四点图标');
  assert((wxml.match(/addmp-gdot/g) || []).length === 4, '橙色四点图标应为 2×2 四个圆点');
  assert(/\.addmp-gdot\s*\{[^}]*border-radius: 50%/.test(wxss), '四点图标应为圆点');
  assert(wxml.includes('在微信首页往下拉，快速打开人情礼单簿'), '第 3 步文案（我们的名称、无书名号）');
  // 深藏青面板卡：小灰字标题＋logo＋白字名称
  assert(wxml.includes('addmp-panel') && wxml.includes('我的小程序'), '教程层应有「我的小程序」面板卡');
  assert(/\.addmp-panel\s*\{[^}]*background: #2B2B3D/.test(wxss), '面板卡应为深藏青底');
  assert(wxml.includes('addmp-panel-logo') && wxml.includes('/images/logo.png'), '面板卡应放我们的 logo 图');
  // 红胶囊「我知道了」保留；旧 CSS 迷你界面示意必须删净
  assert(wxml.includes('我知道了') && wxml.includes('addmp-btn'), '教程层底部应有红色胶囊按钮');
  assert(!wxml.includes('addmp-mock'), '旧迷你界面示意（addmp-mock）应已删净');
  assert(!wxss.includes('.addmp-mock'), '旧迷你界面样式应已删净');
});

test('BA-3 往来页：整页 100vh flex、联系人列表进 scroll-view 独立滚动', () => {
  const wxml = rd('miniprogram/pages/wanglai/wanglai.wxml');
  const wxss = rd('miniprogram/pages/wanglai/wanglai.wxss');
  assert(wxml.includes('class="wl-page"'), '往来页应有整页 flex 容器');
  assert(/\.wl-page\s*\{[^}]*height: 100vh/.test(wxss), '整页容器应为 100vh');
  assert(/\.wl-page\s*\{[^}]*flex-direction: column/.test(wxss), '整页容器应纵向 flex');
  // 汇总/差额在 scroll-view 之上（固定区），列表行在 scroll-view 之内
  const iScroll = wxml.indexOf('<scroll-view');
  const iDiff = wxml.indexOf('diff-bar');
  const iRow = wxml.indexOf('wl-row');
  assert(iDiff >= 0 && iDiff < iScroll, '差额区应在 scroll-view 之前（固定不滚）');
  assert(iRow > iScroll, '联系人列表行应在 scroll-view 内独立滚动');
  assert(wxml.includes('class="wl-scroll" scroll-y'), '列表区应为可纵向滚动的 scroll-view');
  assert(/\.wl-scroll\s*\{[^}]*flex: 1/.test(wxss) && /\.wl-scroll\s*\{[^}]*height: 0/.test(wxss), '列表区应 flex:1＋height:0 撑满剩余高度');
});

test('BA-4 横置样式面板：6 个样式选项两排整排居中', () => {
  const wxss = rd('miniprogram/pages/landscape/book.wxss');
  assert(/\.opt-row\.wrap\s*\{[^}]*flex-wrap: wrap[^}]*justify-content: center/.test(wxss)
    || /\.opt-row\.wrap\s*\{[^}]*justify-content: center[^}]*flex-wrap: wrap/.test(wxss),
    '样式组（.opt-row.wrap）应换行且整排水平居中');
});

test('BA-5 核对页：记录间分隔 #E8E8E8+留白、确认按钮进不透明底栏', () => {
  const wxml = rd('miniprogram/pages/import/import-review.wxml');
  const wxss = rd('miniprogram/pages/import/import-review.wxss');
  // 分隔：记录间线 #E8E8E8 1px＋上下留白（卡底 padding＋非首条头部加高）
  assert(/\.item-card\s*\{[^}]*border-bottom: 1px solid #E8E8E8/.test(wxss), '记录间分隔线应为 #E8E8E8 1px');
  assert(/\.item-card\s*\{[^}]*padding-bottom: 10px/.test(wxss), '记录间线下侧（本卡底部）应多留约 10px 空白');
  assert(/\.item-head\s*\{[^}]*padding: 18px/.test(wxss), '记录间线上侧（下一条头部）应多留空白');
  // 按钮底栏：容器白底不透明＋顶边线；按钮本页覆盖纯主红、无 btn-bottom 悬空形态
  assert(wxml.includes('class="review-bar"'), '确认按钮应放进固定底栏容器');
  assert(wxml.includes('review-confirm'), '确认按钮应带本页覆盖类');
  assert(!wxml.includes('btn-bottom'), '确认按钮不得再用无容器的 btn-bottom 悬空形态');
  assert(/\.review-bar\s*\{[^}]*background: #FFFFFF/.test(wxss), '底栏容器应为白色不透明底');
  assert(/\.review-bar\s*\{[^}]*border-top: 1px solid/.test(wxss), '底栏容器应有顶边发丝线');
  assert(/\.review-bar \.review-confirm\s*\{[^}]*background: #F0575A/.test(wxss), '确认按钮本体应纯主红实心');
  assert(/\.review-bar \.review-confirm\s*\{[^}]*opacity: 1/.test(wxss), '确认按钮必须完全不透明');
});
