/** 我的页陪伴方块（2026-10-31 用户定）+ 头像/会员卡新色：
 * - 陪伴天数：注册当天算第 1 天，之后每天加 1；无/非法注册日返回 null
 * - 方块位置：会员卡片下、横置上面；淡粉 #FDE8E8 + 小书本图标 + “人情礼单簿已陪伴你 X 天”
 * - 头像栏：首页收礼左边 #FFE4B8 半透明淡黄，纯色不渐变
 * - 会员卡：首页送礼右边浓粉红 #F78C8F，纯色不渐变 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const { companionDays } = require('../core/users');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function at(y, m, d) { return new Date(y, m - 1, d, 12, 0, 0).getTime(); }

test('陪伴天数：注册当天算第 1 天，之后每天加 1', async () => {
  assert.eq(companionDays(at(2026, 10, 20), at(2026, 10, 20)), 1, '注册当天应为 1 天');
  assert.eq(companionDays(at(2026, 10, 20), at(2026, 10, 21)), 2, '次日应为 2 天');
  assert.eq(companionDays(at(2026, 10, 20), at(2026, 10, 31)), 12, '10 月 20 日到 10 月 31 日应为 12 天');
});

test('陪伴天数：无/非法注册日返回 null，不显示 0 天或乱数', async () => {
  assert.eq(companionDays(null, at(2026, 10, 31)), null, '无注册日应为 null');
  assert.eq(companionDays(0, at(2026, 10, 31)), null, '注册日 0 应为 null');
  assert.eq(companionDays('not-a-date', at(2026, 10, 31)), null, '非法注册日应为 null');
});

test('我的页陪伴方块：位置、淡粉底、小书本图标、文案与天数接线', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  const mineJs = read('miniprogram/pages/mine/mine.js');
  const memberIdx = wxml.indexOf('会员与积分');
  const companionIdx = wxml.indexOf('人情礼单簿已陪伴你');
  const landscapeIdx = wxml.indexOf('横置礼单本');
  assert(memberIdx >= 0 && companionIdx > memberIdx && landscapeIdx > companionIdx, '方块应在会员卡片下、横置上面');
  assert(wxml.includes('/images/icons/book.svg'), '方块前应有小书本图标');
  assert(wxml.includes('companionDays'), '方块应接 companionDays 天数');
  assert(wxss.includes('#FDE8E8'), '方块底色应为拍照导入淡粉 #FDE8E8');
  assert(mineJs.includes('getCompanionDays'), '我的页应从 data-service 取陪伴天数');
});

test('我的页头像栏与会员卡：新色纯色不渐变', async () => {
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  assert(wxss.includes('rgba(255, 228, 184, 0.6)'), '头像栏应为收礼左边 #FFE4B8 半透明淡黄');
  assert(wxss.includes('background: #F78C8F'), '会员卡应为送礼右边浓粉红 #F78C8F');
  assert(!wxss.includes('linear-gradient(135deg, #FFB84D'), '头像栏不应再有旧橙黄渐变');
  assert(!wxss.includes('linear-gradient(135deg, #F67070'), '会员卡不应再有旧红渐变');
});
