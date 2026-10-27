/**
 * BG批行为断言（用户 2026-10-27 真机验收 BF 后口述定版）：
 * ①横置 14 列；卷轴＋礼单按物理屏幕真居中（补偿左右安全区不对称）；
 *   上下留白同为 39、整本略上移、纸面高不变（两者之和仍 78）。
 * ②我的页：无昵称显示按账号生成的「礼友＋4 位数字」；默认头像换
 *   空白人头图，不再用显示名首字（原「微」字圈）。
 * ③往来页：对照卡/合计/差额/名单连成一片，方块间不露灰（含差额条下方）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core');
const users = require('../core/users');
const rd = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('BG横置定版：14 列、上下留白同为 39 且纸面高不变', () => {
  assert.eq(LC.SPEC.BOOK_COLS, 14, '每本 14 列');
  assert.eq(LC.SPEC.MARGIN_V, 39, '上留白 39');
  assert.eq(LC.SPEC.MARGIN_B, 39, '下留白 39（与上相等）');
  assert.eq(LC.SPEC.MARGIN_V + LC.SPEC.MARGIN_B, 78, '上下之和仍 78——纸面高与列内几何不变');
});

test('BG真居中：midrow 带安全区补偿平移（bookShiftX=(右垫−左垫)/2）', () => {
  const common = rd('miniprogram/pages/landscape/book-common.js');
  assert(common.includes('((this.data.safePadR || 0) - (this.data.safePadL || 0)) / 2'), '补偿量按左右安全区差的一半算');
  const wxml = rd('miniprogram/pages/landscape/book.wxml');
  assert(wxml.includes('transform:translateX({{view.bookShiftX}}px)'), 'midrow 应用补偿平移、按整屏居中');
});

test('BG生成昵称：格式、恒定、无账号回退', () => {
  const a = users.generatedNickname('o6zAJs1KgKKXfJFwqKQqzfnNbjHs');
  assert(/^礼友\d{4}$/.test(a), '格式「礼友＋4位数字」');
  assert.eq(users.generatedNickname('o6zAJs1KgKKXfJFwqKQqzfnNbjHs'), a, '同账号恒定');
  assert.eq(users.generatedNickname(''), '礼友', '无账号只回「礼友」');
  assert.eq(users.displayName({ _id: 'o6zAJs1KgKKXfJFwqKQqzfnNbjHs' }), a, 'displayName 无昵称时用生成昵称');
});

test('BG我的页默认头像：空白人头图、无字圈残留', () => {
  const wxml = rd('miniprogram/pages/mine/mine.wxml');
  assert(wxml.includes('/assets/avatar-default.png'), '默认头像用空白人头图');
  assert(!wxml.includes('avatar-initial'), '不得再用字圈头像');
  const js = rd('miniprogram/pages/mine/mine.js');
  assert(!js.includes('avatarInitial'), 'mine.js 不得再算字圈首字');
  assert(fs.existsSync(path.join(__dirname, '..', 'miniprogram/assets/avatar-default.png')), '默认头像图文件存在');
});

test('BG往来页去灰：方块全宽贴合、合计白底、差额无下边距、列表区白底', () => {
  const wxss = rd('miniprogram/pages/wanglai/wanglai.wxss');
  assert(wxss.includes('.wl-scroll { flex: 1; height: 0; background: #fff; }'), '列表滚动区白底不露灰');
  assert(wxss.includes('.wl-scroll .card { margin: 0; border-radius: 0; }'), '名单卡全宽无边距');
  assert(wxss.includes('margin: 6px 0 0'), '对照卡全宽、上边距收小');
  const total = wxss.slice(wxss.indexOf('.total-line {'), wxss.indexOf('.total-line {') + 200);
  assert(total.includes('background: #fff'), '合计行白底、不坐灰');
  const diff = wxss.slice(wxss.indexOf('.diff-bar {'), wxss.indexOf('.diff-bar {') + 200);
  assert(diff.includes('margin: 0;'), '差额条零边距——下方那条灰去掉');
  assert(!wxss.includes('margin: 8px 12px 12px'), '差额条旧灰隔边距不得残留');
});
