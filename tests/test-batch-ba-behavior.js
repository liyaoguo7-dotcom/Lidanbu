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

test('BA-1 顶条：BE批已整体删除（微信自带同款服务条，自制件重复）', () => {
  assert(!fs.existsSync(path.join(__dirname, '..', 'miniprogram/components/top-banner/top-banner.wxml')), 'top-banner 组件应已删除');
  const idxWxml = rd('miniprogram/pages/index/index.wxml');
  assert(!idxWxml.includes('top-banner'), '首页不得再挂 top-banner');
  const idxJson = rd('miniprogram/pages/index/index.json');
  assert(!idxJson.includes('top-banner'), '首页不得再注册 top-banner');
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

test('BA-3/DC 往来页：取消固定头、搜索＋对照＋合计 sticky 置顶、联系人随页滑动', () => {
  const wxml = rd('miniprogram/pages/wanglai/wanglai.wxml');
  const wxss = rd('miniprogram/pages/wanglai/wanglai.wxss');
  assert(wxml.includes('class="wl-page {{swipeAnim ? \'swipe-back\' : \'\'}}"'), '往来页应有整页容器（DA批加弹回类）');
  // DC批取代 BA 固定头：整页不再 100vh，列表不再用 scroll-view 独立滚动
  const pageRule = wxss.slice(wxss.indexOf('.wl-page {'), wxss.indexOf('.wl-page {') + 80);
  assert(!pageRule.includes('height: 100vh'), 'DC批：整页不再 100vh 固定');
  assert(!wxml.includes('<scroll-view'), 'DC批：列表不再用 scroll-view 独立滚动');
  // sticky 组顺序：搜索框＋对照＋合计在 sticky 内、列表之前；列表行在列表区内
  const iSticky = wxml.indexOf('class="wl-sticky"');
  const iSearch = wxml.indexOf('class="searchbar"');
  const iCompare = wxml.indexOf('class="compare"');
  const iSummary = wxml.indexOf('class="summary-card"');
  const iList = wxml.indexOf('class="wl-list"');
  const iRow = wxml.indexOf('wl-row');
  assert(iSticky >= 0 && iSticky < iSearch && iSearch < iCompare && iCompare < iSummary && iSummary < iList, '搜索框＋对照＋合计应在 sticky 组内、列表之前');
  assert(iRow > iList, '联系人列表行应在列表区内随页滑动');
  assert(/\.wl-sticky\s*\{[^}]*position: sticky[^}]*top: 0/.test(wxss), 'sticky 组应吸顶（top:0）');
  assert(wxml.includes('<view class="wl-list">'), '列表区应为普通 view 随页滑动');
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
  assert(/\.item-head\s*\{[^}]*background: #FAF3E3/.test(wxss), '每条第一行应带浅米色带 #FAF3E3（用户追加）');
  // 按钮底栏：容器白底不透明＋顶边线；按钮本页覆盖纯主红、无 btn-bottom 悬空形态
  assert(wxml.includes('class="review-bar"'), '确认按钮应放进固定底栏容器');
  assert(wxml.includes('review-confirm'), '确认按钮应带本页覆盖类');
  assert(!wxml.includes('btn-bottom'), '确认按钮不得再用无容器的 btn-bottom 悬空形态');
  assert(/\.review-bar\s*\{[^}]*background: #FFFFFF/.test(wxss), '底栏容器应为白色不透明底');
  assert(/\.review-bar\s*\{[^}]*border-top: 1px solid/.test(wxss), '底栏容器应有顶边发丝线');
  assert(/\.review-bar \.review-confirm\s*\{[^}]*background: #F0575A/.test(wxss), '确认按钮本体应纯主红实心');
  assert(/\.review-bar \.review-confirm\s*\{[^}]*opacity: 1/.test(wxss), '确认按钮必须完全不透明');
});
