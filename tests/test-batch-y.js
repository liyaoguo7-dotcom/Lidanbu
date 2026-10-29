/** 真机反馈第二批（任务Y，2026-10-22 用户今早逐条确认后的定版口径）：
 * A 横置三改回退；B 横置列序（第一条最左）+ 全量确定性渲染；C 返回竖置重同步方向；
 * D 样式按钮胶囊避让；E 请横屏页返回按钮加大下移；F 小喇叭新规格；G 列表行距再收紧。 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const REPO = path.join(__dirname, '..');
const MP = path.join(REPO, 'miniprogram');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const hornState = require('../miniprogram/services/horn-state.js');

// ---------- A：横置三改回退 ----------
test('任务Y-A回退：三页 pageOrientation 全为 auto、按钮恢复定版文案、底部返回竖屏按钮已删', () => {
  for (const p of ['pages/landscape/receive/receive.json', 'pages/landscape/gift/gift.json', 'pages/landscape/rotate/rotate.json']) {
    assert(JSON.parse(readMp(p)).pageOrientation === 'auto', `${p} 应为 auto（自动感应）`);
  }
  assert.eq(LC.ROTATE_COPY.backButton, '切换回竖置样式', '按钮恢复定版图30文案');
  const book = readMp('pages/landscape/book.wxml');
  assert(!book.includes('goBackToPortrait'), 'book.wxml 不应再有底部「返回竖屏」按钮');
  assert(!book.includes('back-portrait'), 'book.wxml 不应再有 back-portrait 控件');
  assert(!readMp('pages/landscape/book-common.js').includes('goBackToPortrait'), 'book-common 不应再有 goBackToPortrait');
});

// ---------- B：列序第一条最左 + 全量渲染 ----------
test('任务Y-B列序：第一条放最左、记录正序向右、空列补在最右侧', () => {
  const recs = [1, 2, 3].map((i) => ({ id: String(i), name: '张三', amountFen: 10000, tagId: 'jiehun' }));
  const built = LC.buildColumns(recs, {});
  assert.eq(built.columns[0].recordId, '1', '最左列是第一条记录');
  assert.eq(built.columns[1].recordId, '2', '第二条紧随其右');
  assert.eq(built.columns[2].recordId, '3', '第三条再右');
  assert(built.columns.slice(3).every((c) => c.empty), '其余列全是空格子');
  assert.eq(built.emptyCount, 11, '空列数 = 14 - 3（BG批定版14列）');
});

test('任务Y-B列序：超一屏按记录数扩展且顺序不乱（左右滑动查看）', () => {
  const recs = Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), name: '张三', amountFen: 1, tagId: 'jiehun' }));
  const built = LC.buildColumns(recs, {});
  assert.eq(built.totalGrid, 15, '总列数 = 记录数');
  assert.eq(built.columns.map((c) => c.recordId).join(','), recs.map((r) => r.id).join(','), '列序与账本顺序一致');
});

test('任务Y-B全量渲染：页面不再窗口化，scrollLeft 恒 0，渲染与滚动位置解耦', () => {
  const bc = readMp('pages/landscape/book-common.js');
  assert(!bc.includes('LC.windowRange'), 'book-common 不应再调用 windowRange 窗口化');
  assert(!bc.includes('_applyWindow'), 'book-common 不应再有 _applyWindow');
  assert(bc.includes('_convertCols()'), 'book-common 应有全量列转换 _convertCols');
  assert(bc.includes('scrollLeft: 0'), '_afterBuild 应把 scrollLeft 定位到 0（第一条最左）');
  const book = readMp('pages/landscape/book.wxml');
  assert(book.includes('wx:for="{{cols}}"'), 'book.wxml 应全量遍历 cols');
  assert(!book.includes('Spacer'), 'book.wxml 不应再有左右占位 spacer');
  assert(!book.includes('bindscroll'), 'book.wxml 不应再绑定滚动驱动渲染');
});

// ---------- C：返回竖置重同步 ----------
test('任务Y-C返回重同步：onShow 先按当前窗口尺寸同步方向再刷新数据', () => {
  const bc = readMp('pages/landscape/book-common.js');
  assert(bc.includes('_syncOrientation()'), 'book-common 应有 _syncOrientation');
  const onShow = bc.slice(bc.indexOf('async onShow()'), bc.indexOf('onResize(res)'));
  assert(onShow.includes('_syncOrientation()'), 'onShow 应重同步方向（后台页收不到 onResize）');
  assert(onShow.indexOf('_syncOrientation()') < onShow.indexOf('this.reload()'), '方向同步应在 reload 之前');
});

// ---------- D：样式按钮避让胶囊 ----------
test('任务Y-D样式按钮：按胶囊实测位置动态右偏移（≥12px 间隔、带固定兜底）', () => {
  const bc = readMp('pages/landscape/book-common.js');
  assert(bc.includes('getMenuButtonBoundingClientRect'), '应读取微信胶囊位置');
  assert(bc.includes('styleRightPx'), '应算出 styleRightPx');
  const book = readMp('pages/landscape/book.wxml');
  assert(book.includes('margin-right:{{styleRightPx}}px'), '样式按钮右距应由 styleRightPx 内联注入');
});

// ---------- E：请横屏页返回按钮（DH批：改与系统箭头一致） ----------
test('任务Y-E返回按钮：箭头 44rpx、可点区 88rpx、顶栏顶垫状态栏', () => {
  const wxss = readMp('pages/landscape/book.wxss');
  const back = (wxss.match(/\.rotate-back \{[^}]*\}/) || [''])[0];
  assert(back.includes('font-size: 44rpx'), '返回箭头约 22px（44rpx，贴近系统箭头）');
  assert(back.includes('width: 88rpx') && back.includes('height: 88rpx'), '可点区域 ≥44px（88rpx）');
  assert(wxss.includes('env(safe-area-inset-top)'), '顶部标题行顶垫状态栏，箭头不再贴角');
});

// ---------- F：小喇叭新规格 ----------
test('任务Y-F喇叭状态：关闭只记内存、复位后恢复（模拟冷启动）', () => {
  hornState._resetForTest();
  assert.eq(hornState.isDismissed('index'), false, '初始未关闭');
  hornState.dismiss('index');
  assert.eq(hornState.isDismissed('index'), true, '关闭后本次期间不再显示');
  assert.eq(hornState.isDismissed('receive'), false, '各喇叭互不影响');
  hornState._resetForTest();
  assert.eq(hornState.isDismissed('index'), false, '冷启动（模块复位）后恢复显示');
});

test('任务Y-F喇叭实现：无 storage 持久化、全实例带关闭叉（闪烁/点开滑动已于任务AB 第 8 项改版）', () => {
  const hs = readMp('services/horn-state.js');
  assert(!hs.includes('wx.'), 'horn-state 不得碰 wx storage（只存内存）');
  const receiveJs = readMp('pages/receive/receive.js');
  assert(!receiveJs.includes('receiveHornClosed'), '收礼页不应再用 storage 存喇叭关闭状态');
  assert(receiveJs.includes("hornState.isDismissed('receive')"), '收礼页应读内存关闭状态');
  for (const p of ['pages/index/index.wxml', 'pages/contacts/contacts.wxml', 'pages/choose-contact/choose-contact.wxml',
    'pages/import/import-home.wxml', 'pages/import/import-event.wxml', 'pages/import/import-review.wxml']) {
    const w = readMp(p);
    assert(w.includes('tip-close') && w.includes('onHornClose'), `${p} 喇叭应有关闭叉`);
    assert(w.includes('horn-track') && w.includes('hornRun'), `${p} 喇叭应为慢速左滚结构（任务AB）`);
    assert(!w.includes('horn-blink') && !w.includes('hornWide'), `${p} 不得再有闪烁/点开滑动（任务AB）`);
  }
  const tb = readMp('components/tip-bar/tip-bar.wxml');
  assert(tb.includes('onClose') && tb.includes('horn-track'), 'tip-bar 组件应同规格（任务AB）');
  const receiveWxml = readMp('pages/receive/receive.wxml');
  assert(receiveWxml.includes('horn-track') && receiveWxml.includes('closeHorn'), '收礼页喇叭应为慢速左滚结构（任务AB）');
});

// ---------- G：列表行距再收紧 ----------
test('任务Y-G行距：五处联系人列表行数值再收紧一档（送礼/收礼记录行高 2026-10-24 用户改定 64px）', () => {
  assert(readMp('pages/contacts/contacts.wxss').includes('min-height: 50px'), '亲友录行 min-height 54→50');
  const rd = readMp('pages/receive-detail/receive-detail.wxss');
  assert(rd.includes('height: 64px'), '收礼记录行：2026-10-24 用户改定固定高 64px（原 AE 定版 76px，用户亲令再收紧）');
  const gf = readMp('pages/gifts/gifts.wxss');
  assert(gf.includes('height: 64px'), '送礼行：2026-10-24 用户改定固定高 64px');
  const wl = readMp('pages/wanglai/wanglai.wxss');
  // AP批用户改定（2026-10-26，晚于 Y 批）：往来页联系人行间隔加大 9→13px，
  // 仅往来页本行覆盖 Y 的收紧值，其余四处不动
  assert(!wl.includes('padding: 11px 16px') && wl.includes('padding: 13px 16px'), '往来行 padding AP批改定 13px');
  const rv = readMp('pages/receive/receive.wxss');
  assert(rv.includes('padding: 8px 16px; min-height: 58px'), '收礼礼薄行 padding 10→8、min-height 62→58');
});
