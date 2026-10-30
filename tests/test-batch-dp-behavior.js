/** DP批（用户 2026-10-30 定）：收礼页行点按防重复——点按后先查会员／开关才跳转，
 * 等待期间再点会压两个详情页；故 1.5 秒内重复点按直接忽略，1.5 秒后自动恢复；
 * 收回滑开行那一下不记时间戳；跳转逻辑与滑动删除全不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DP 收礼页行点按：1.5 秒内重复点按忽略＋其余不动', () => {
  const js = readMp('pages/receive/receive.js');
  const body = js.slice(js.indexOf('async onRowTap(e) {'), js.indexOf('// ---- ⋯ ----'));
  assert(body.includes('if (now - (this._lastRowTap || 0) < 1500) return;'), '1.5 秒内重复点按直接忽略');
  assert(body.includes('this._lastRowTap = now;'), '点按时间戳记下');
  const closeIdx = body.indexOf('closeAllSwipes()');
  const guardIdx = body.indexOf('this._lastRowTap');
  const navIdx = body.indexOf('await this._ensureMembership()');
  assert(closeIdx >= 0 && guardIdx > closeIdx, '收回滑开行在前、防重复在后（收回那一下不记时间戳）');
  assert(navIdx > guardIdx, '时间戳在异步查询前就记（等待期间的第二次点按也被挡）');
  assert(body.includes('wx.navigateTo({ url: `/pages/landscape/receive/receive?eventId=${id}${owner}` });'), '横置路由不动');
  assert(body.includes('wx.navigateTo({ url: `/pages/receive-detail/receive-detail?id=${id}` });'), '竖置详情路由不动');
  assert(js.includes('onMore(e) {'), '⋯菜单入口不动');
});
