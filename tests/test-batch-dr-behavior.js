/** 2026-10-31 凌晨批（DR）：
 * - 亲友列表缓存污染修复：未登录空结果不缓存、已登录空列表带归属可缓存、
 *   换号缓存不 serving、亲友页强制刷新、首查加载态、送礼列表自愈（覆盖全部姓名显示处共用层）
 * - 家庭共享邀请无码分享修复：分享按钮 gated 于 inviteCode
 * - 退款文案：虚拟产品一经购买不能退款
 * - 送礼页两栏背景互换、收礼礼簿独立方块与共计栏、礼薄详情顶部重构 */
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const dataService = require('../miniprogram/services/data-service');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

async function freshUser() {
  dataService._resetForTest();
  const db = await h.newDB();
  dataService._setDbFactoryForTest(() => db);
  const r = await dataService.init();
  assert(r && r.ok === true, `init 应成功（实际 ${JSON.stringify(r)}）`);
  const userId = dataService.userId;
  assert(userId, 'init 后应有 userId');
  return { db, userId };
}

test('DR缓存：已登录空列表可缓存（带归属），经 data-service 写穿后即时可见；外部直写须 force 才查回', async () => {
  const { db, userId } = await freshUser();
  try {
    const empty = await dataService.listContacts();
    assert(Array.isArray(empty) && empty.length === 0, '新用户亲友应为空');
    // 会话缓存口径与非空一致（2026-10-24 写穿契约）：普通读命中缓存，仍为空
    const emptyAgain = await dataService.listContacts();
    assert(emptyAgain.length === 0, '已登录空列表普通读应命中缓存（仍为空）');
    // 应用内写路径走 data-service 写穿：新建后不须重查即在列表里
    const created = await dataService.createContact({ name: '缓存对照甲' });
    const createdId = (created && (created._id || (created.contact && created.contact._id))) || null;
    const list = await dataService.listContacts();
    assert(list.length === 1 && list[0].name === '缓存对照甲',
      `写穿后列表应为 1 条（实际 ${list.length} 条）`);
    void createdId; void db; void userId;
    // 绕开 data-service 的外部直写不走写穿：普通读仍为旧缓存，force 才查回
    await core.contacts.createContact(db, userId, userId, { name: '缓存对照乙' });
    assert((await dataService.listContacts()).length === 1, '外部直写后普通读应仍为旧缓存（会话缓存口径）');
    const forced = await dataService.listContacts({ force: true });
    assert(forced.length === 2, `强制刷新应查回 2 条（实际 ${forced.length} 条）`);
  } finally { dataService._resetForTest(); }
});

test('DR缓存：登录前查回的空不得污染登录后查询', async () => {
  dataService._resetForTest();
  const pre = await dataService.listContacts();
  assert(Array.isArray(pre) && pre.length === 0, '未登录时应返回空且不抛');
  const { db, userId } = await freshUser();
  try {
    await core.contacts.createContact(db, userId, userId, { name: '预登录污染对照' });
    const list = await dataService.listContacts();
    assert(list.length === 1 && list[0].name === '预登录污染对照',
      `预登录空结果不得污染登录后查询（实际 ${list.length} 条）`);
  } finally { dataService._resetForTest(); }
});

test('DR缓存：强制刷新跳过缓存，普通读命中缓存', async () => {
  const { db, userId } = await freshUser();
  try {
    await core.contacts.createContact(db, userId, userId, { name: '甲' });
    const first = await dataService.listContacts();
    assert(first.length === 1, '首查应为 1 条');
    await core.contacts.createContact(db, userId, userId, { name: '乙' });
    const cached = await dataService.listContacts();
    assert(cached.length === 1, '非强制读应命中缓存（仍 1 条）');
    const forced = await dataService.listContacts({ force: true });
    assert(forced.length === 2, `强制刷新应查回 2 条（实际 ${forced.length} 条）`);
  } finally { dataService._resetForTest(); }
});

test('DR缓存：送礼空列表可缓存（带归属），经 data-service 写穿后即时可见', async () => {
  const { db, userId } = await freshUser();
  try {
    const g0 = await dataService.listGifts();
    assert(g0.length === 0, '新用户送礼应为空');
    assert((await dataService.listGifts()).length === 0, '已登录空列表普通读应命中缓存（仍为空）');
    const c = await dataService.createContact({ name: '丙' });
    const contactId = (c && (c._id || (c.contact && c.contact._id))) || null;
    await dataService.createGift({ contactId, tagId: 'shengri', amountFen: 10000, date: '2026-10-01' });
    const g1 = await dataService.listGifts();
    assert(g1.length === 1, `写穿后送礼应为 1 条（实际 ${g1.length} 条）`);
    void db; void userId;
  } finally { dataService._resetForTest(); }
});

test('DR邀请：分享按钮必须 gated 于 inviteCode，无码不得分享', () => {
  const wxml = read('miniprogram/pages/share/share-invite.wxml');
  assert(wxml.includes('disabled="{{!canInvite || !inviteCode}}"'),
    '分享按钮 disabled 必须同时看 canInvite 与 inviteCode');
  assert(wxml.includes('邀请准备中，请稍候'), '码未到时应显示“邀请准备中”提示');
  const js = read('miniprogram/pages/share/share-invite.js');
  assert(js.includes("path: code ? `/pages/share/share-view?code=${code}` : '/pages/share/share-home'"),
    '有码走 share-view、无码回落 share-home 的防御路径应保留');
});

test('DR退款文案：虚拟产品一经购买不能退款（前后端副本一致，旧文案清零）', () => {
  const src = read('miniprogram/config/app-config.js');
  const api = read('cloudfunctions/api/miniprogram/config/app-config.js');
  assert(src.includes('本产品为虚拟产品，一经购买不能退款，购买前请确定。'), '购买页退款文案应为新口径');
  assert(api.includes('本产品为虚拟产品，一经购买不能退款，购买前请确定。'), '云端副本退款文案应同步');
  assert(!src.includes('安卓用户可在购买后主动申请退款'), '旧退款文案应清零');
});

test('DR送礼页颜色：两栏互换（横置取共计最左再浅一号，共计取横置原淡黄，数字改红）', () => {
  const wxss = read('miniprogram/pages/gifts/gifts.wxss');
  assert(wxss.includes('.card.entry-row { margin-top: 0; margin-bottom: 0; background: #FFD2CF; }'),
    '横置入口块应为 #FFD2CF（#FFC7C3 再浅一号纯色）');
  assert(wxss.includes('.total-line { text-align: center; font-size: 20px; padding: 8px 16px 6px; color: #333; background: #FBF3D9;'),
    '共计块应为横置原淡黄 #FBF3D9 纯色（渐变作废）');
  assert(wxss.includes('.total-line .red { color: #E05353;'), '共计数字在淡黄上不得用白字，应改收礼共计红 #E05353');
});

test('DR收礼礼簿：卡片独立方块（无共用白框细线）与共计栏（大一号、灰字加深、红不动）', () => {
  const wxss = read('miniprogram/pages/receive/receive.wxss');
  assert(!/\.list\s*\{[^}]*background:\s*#fff/.test(wxss), '共用白底大框应取消');
  assert(wxss.includes('.swipe-wrap { position: relative; margin-bottom: 8px; border-radius: 12px; overflow: hidden; }'),
    '每块应自带圆角与 8px 块间隙');
  assert(!wxss.includes('border-bottom: 1px solid #F0F0F0; }\n.swipe-wrap:last-child'),
    '块间细线应取消（不再用 border-bottom 隔开）');
  assert(wxss.includes('.total-line { font-size: 14px; color: #999;'), '共计栏字号 12px→14px、灰字 #C2C2C2→#999');
  assert(wxss.includes('.total-num { color: #E05353;'), '共计金额红 #E05353 不动');
});

test('DR礼薄详情：顶部重构（第一方块图案标签名日期滚动，第二方块共计吸顶）', () => {
  const wxml = read('miniprogram/pages/receive-detail/receive-detail.wxml');
  assert(!wxml.includes('info-stick') && !wxml.includes('event-total'), '旧 info-stick/event-total 结构应拆除');
  assert(wxml.includes('class="card head-card'), '第一方块 head-card 应存在');
  const headBlock = wxml.slice(wxml.indexOf('head-card'));
  assert(headBlock.includes('class="event-name"') && headBlock.includes('class="event-date'),
    '第一方块内应含礼薄名与日期');
  assert(wxml.includes('class="card total-stick'), '第二方块 total-stick（共计吸顶）应存在');
  const wxss = read('miniprogram/pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.card.head-card { background: #FFE4B8;'), '第一方块底色应为首页收礼最左浅色 #FFE4B8');
  assert(wxss.includes('.card.total-stick { background: #FBF3D9;'), '共计块底色应为送礼页横置栏改动前淡黄 #FBF3D9');
  assert(wxss.includes('.total-stick { position: sticky; top: 54px;'), '共计块吸顶位置 top:54px 不动');
});

test('DR亲友页：首查加载态（未 settled 前不显示“还没有亲友”）与送礼自愈', () => {
  const wxml = read('miniprogram/pages/contacts/contacts.wxml');
  assert(wxml.includes('wx:if="{{loadingContacts}}"'), '首查应有加载中行');
  assert(wxml.includes('wx:if="{{groups.length === 0 && !loadingContacts}}"'),
    '空提示必须 gated 于 !loadingContacts');
  const js = read('miniprogram/pages/contacts/contacts.js');
  assert(js.includes('listContacts({ force: true })'), '亲友页每次 onShow 应强制刷新');
  const giftsJs = read('miniprogram/pages/gifts/gifts.js');
  assert(giftsJs.includes('if (list.length > 0 && contacts.length === 0)') &&
    giftsJs.includes('listContacts({ force: true })'),
    '送礼列表有记录无联系人时应强制重取一次自愈');
});

test('DR共用层：未登录空结果不缓存与换号不 serving 应写进 data-service', () => {
  const src = read('miniprogram/services/data-service.js');
  assert(src.includes('function _cacheList(name, list)'), '应有 _cacheList 带归属缓存助手');
  assert(src.includes('_listCacheOwner'), '缓存应带归属用户，换号不得 serving 旧缓存');
  assert(src.includes('if (!_userId) return [];'), '未登录时应不查不缓存');
  assert(src.includes('if (!_userId) return list;'), '_cacheList 本身未登录时也不得写缓存（防御）');
});
