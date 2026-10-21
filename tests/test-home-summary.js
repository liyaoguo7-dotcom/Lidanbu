/** 首页小结与最近往来（任务V）：
 * - getHomeRecent：收礼+送礼两类合并、按 date 倒序（同日按 createdAt 倒序）、含送礼条目
 * - getHomeSummary：只算本自然月，跨月不计
 * - 空数据：小结零态（hasRecords=false）、最近往来返回 []
 * - 只统计本人账本：他人账本（成员视角能看的共享账本）记录不混入
 * data-service 是单例：每例换新 MemoryDB + 状态化 wx 存储 mock（标记已种种子，跳过演示数据）。 */
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const core = require('../core');
const { COLLECTIONS } = core.models;
const dataService = require('../miniprogram/services/data-service');

const ROOT = path.join(__dirname, '..');

/** 装一个带存储的 wx mock（预置"已种种子"标记，让 init 不种演示数据）；返回恢复函数 */
function installWx() {
  const prev = global.wx;
  const store = new Map([['lidanbu_demo_seeded_v2', true]]);
  global.wx = {
    getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
    setStorageSync: (k, v) => { store.set(k, v); },
    removeStorageSync: (k) => { store.delete(k); },
  };
  return () => { global.wx = prev; };
}

/** 复位 data-service 单例并以新 MemoryDB 初始化；返回 { db, uid } */
async function freshService() {
  const db = new core.db.MemoryDB();
  dataService._resetForTest();
  dataService._setDbFactoryForTest(() => db);
  const r = await dataService.init();
  assert(r && r.ok === true, 'init 应成功');
  return { db, uid: dataService.userId };
}

function teardown(restore) {
  dataService._resetForTest();
  restore();
}

test('首页最近往来：收送两类合并按日期倒序、同日按创建时间倒序，含送礼条目', async () => {
  const restore = installWx();
  try {
    const { db, uid } = await freshService();
    const C = COLLECTIONS;
    await db.collection(C.Contact).insert({ _id: 'ct-zs', ownerId: uid, name: '张三' });
    await db.collection(C.Contact).insert({ _id: 'ct-ls', ownerId: uid, name: '李四' });
    await db.collection(C.ReceiveEvent).insert({ _id: 'ev-1', ownerId: uid, name: '张三的婚礼', tagId: 'jiehun', date: '2026-03-20' });
    // 收礼 3/20（日期最新，createdAt 最小也应排第一）
    await db.collection(C.ReceiveRecord).insert({
      _id: 'rec-a', ownerId: uid, eventId: 'ev-1', contactId: 'ct-zs',
      amount: 100000, type: '现金', date: '2026-03-20', createdAt: 1000,
    });
    // 收礼 3/18（同日 createdAt 更大 → 排在同日送礼之前）
    await db.collection(C.ReceiveRecord).insert({
      _id: 'rec-b', ownerId: uid, eventId: 'ev-1', contactId: 'ct-ls',
      amount: 200000, type: '红包', date: '2026-03-18', createdAt: 5000,
    });
    // 送礼 3/18（同日 createdAt 更小）
    await db.collection(C.GiftRecord).insert({
      _id: 'gift-a', ownerId: uid, contactId: 'ct-ls', tagId: 'shengri',
      amount: 50000, date: '2026-03-18', createdAt: 3000,
    });
    // 送礼 3/10（最旧，默认 limit=3 时被截掉）
    await db.collection(C.GiftRecord).insert({
      _id: 'gift-b', ownerId: uid, contactId: 'ct-zs', tagId: 'jiehun',
      amount: 30000, date: '2026-03-10', createdAt: 9000,
    });

    const recent = await dataService.getHomeRecent();
    assert.eq(recent.length, 3, '默认取前 3 条');
    assert.eq(recent.map((x) => x.kind).join(','), 'receive,receive,gift', '两类合并、顺序为收(3/20)、收(3/18新)、送(3/18旧)');
    assert.eq(recent[0].contactName, '张三', '第一条联系人');
    assert.eq(recent[0].tagName, '结婚', '收礼 tagName 为礼薄标签名');
    assert.eq(recent[0].eventName, '张三的婚礼', '收礼带礼薄名');
    assert.eq(recent[0].amountText, '+1000.00', '收礼金额 +两位小数');
    assert.eq(recent[0].dateText, '3月20日', '日期文案');
    assert.eq(recent[0].targetUrl, '/pages/receive-record-detail/receive-record-detail?id=rec-a', '收礼跳收礼记录详情');
    assert.eq(recent[1].amountText, '+2000.00', '同日按 createdAt 倒序：rec-b 在前');
    assert.eq(recent[2].kind, 'gift', '第三条是送礼（送礼必须出现在结果中）');
    assert.eq(recent[2].contactName, '李四', '送礼联系人');
    assert.eq(recent[2].tagName, '生日', '送礼 tagName 为场合标签名');
    assert.eq(recent[2].eventName, '', '送礼无礼薄名');
    assert.eq(recent[2].amountText, '-500.00', '送礼金额 -两位小数');
    assert.eq(recent[2].targetUrl, '/pages/gift-detail/gift-detail?id=gift-a', '送礼跳送礼详情');

    const all = await dataService.getHomeRecent(10);
    assert.eq(all.length, 4, 'limit 放大后 4 条全出');
    assert.eq(all[3].targetUrl, '/pages/gift-detail/gift-detail?id=gift-b', '最旧的送礼排最后');
    const two = await dataService.getHomeRecent(2);
    assert.eq(two.length, 2, 'limit=2 只取 2 条');
  } finally { teardown(restore); }
});

test('首页本月小结：只算本自然月，跨月记录不计', async () => {
  const restore = installWx();
  try {
    const { db, uid } = await freshService();
    const C = COLLECTIONS;
    const nowD = new Date();
    const cur = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
    const prevD = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 15);
    const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
    await db.collection(C.Contact).insert({ _id: 'ct-1', ownerId: uid, name: '张三' });
    await db.collection(C.ReceiveEvent).insert({ _id: 'ev-m', ownerId: uid, name: '本月礼薄', tagId: 'jiehun', date: `${cur}-05` });
    // 本月：收 1000 + 收 500 + 送 500
    await db.collection(C.ReceiveRecord).insert({ _id: 'rm-1', ownerId: uid, eventId: 'ev-m', contactId: 'ct-1', amount: 100000, type: '现金', date: `${cur}-05`, createdAt: 1 });
    await db.collection(C.ReceiveRecord).insert({ _id: 'rm-2', ownerId: uid, eventId: 'ev-m', contactId: 'ct-1', amount: 50000, type: '现金', date: `${cur}-20`, createdAt: 2 });
    await db.collection(C.GiftRecord).insert({ _id: 'gm-1', ownerId: uid, contactId: 'ct-1', tagId: 'shengri', amount: 50000, date: `${cur}-11`, createdAt: 3 });
    // 上月：大额收/送各一笔，必须被排除
    await db.collection(C.ReceiveRecord).insert({ _id: 'rp-1', ownerId: uid, eventId: 'ev-m', contactId: 'ct-1', amount: 999900, type: '现金', date: `${prev}-15`, createdAt: 4 });
    await db.collection(C.GiftRecord).insert({ _id: 'gp-1', ownerId: uid, contactId: 'ct-1', tagId: 'shengri', amount: 888800, date: `${prev}-15`, createdAt: 5 });

    const s = await dataService.getHomeSummary();
    assert.eq(s.receiveFen, 150000, '本月收礼合计只算本月两笔');
    assert.eq(s.receiveCount, 2, '本月收礼笔数');
    assert.eq(s.giftFen, 50000, '本月送礼合计只算本月一笔');
    assert.eq(s.giftCount, 1, '本月送礼笔数');
    assert.eq(s.hasRecords, true, '本月有记录');
  } finally { teardown(restore); }
});

test('首页空数据：小结零态、最近往来为空', async () => {
  const restore = installWx();
  try {
    await freshService();
    const s = await dataService.getHomeSummary();
    assert.eq(s.receiveFen, 0, '无记录收礼为 0');
    assert.eq(s.giftFen, 0, '无记录送礼为 0');
    assert.eq(s.receiveCount + s.giftCount, 0, '无记录笔数为 0');
    assert.eq(s.hasRecords, false, '零态标记（页面据此显示"本月还没有记录"，不显示 ¥0）');
    const recent = await dataService.getHomeRecent();
    assert(Array.isArray(recent) && recent.length === 0, '无记录时最近往来返回 []（页面整卡不渲染）');
  } finally { teardown(restore); }
});

test('首页数据只含本人账本：他人账本记录不混入小结与最近往来', async () => {
  const restore = installWx();
  try {
    const { db, uid } = await freshService();
    const C = COLLECTIONS;
    const nowD = new Date();
    const cur = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
    // 本人：本月一笔收礼
    await db.collection(C.Contact).insert({ _id: 'ct-own', ownerId: uid, name: '张三' });
    await db.collection(C.ReceiveEvent).insert({ _id: 'ev-own', ownerId: uid, name: '我的礼薄', tagId: 'jiehun', date: `${cur}-10` });
    await db.collection(C.ReceiveRecord).insert({ _id: 'rec-own', ownerId: uid, eventId: 'ev-own', contactId: 'ct-own', amount: 70000, type: '现金', date: `${cur}-10`, createdAt: 100 });
    // 他人账本（成员视角能看的共享账本）：本月、日期更新、金额更大——一条都不许混入
    const other = 'other-owner';
    await db.collection(C.Contact).insert({ _id: 'ct-other', ownerId: other, name: '王五' });
    await db.collection(C.ReceiveEvent).insert({ _id: 'ev-other', ownerId: other, name: '他人礼薄', tagId: 'jiehun', date: `${cur}-12` });
    await db.collection(C.ReceiveRecord).insert({ _id: 'rec-other', ownerId: other, eventId: 'ev-other', contactId: 'ct-other', amount: 999900, type: '现金', date: `${cur}-12`, createdAt: 999 });
    await db.collection(C.GiftRecord).insert({ _id: 'gift-other', ownerId: other, contactId: 'ct-other', tagId: 'shengri', amount: 888800, date: `${cur}-13`, createdAt: 998 });

    const s = await dataService.getHomeSummary();
    assert.eq(s.receiveFen, 70000, '小结只算本人收礼');
    assert.eq(s.giftFen, 0, '他人的送礼不计入小结');
    assert.eq(s.receiveCount, 1, '小结笔数只算本人');
    const recent = await dataService.getHomeRecent(10);
    assert.eq(recent.length, 1, '最近往来只有本人一笔');
    assert.eq(recent[0].amountText, '+700.00', '最近往来是本人那笔');
    assert.eq(recent[0].contactName, '张三', '最近往来联系人是本人的');
  } finally { teardown(restore); }
});

test('首页接线：小结条/最近往来卡在 wxml、js 走 data-service 真接口、查看全部跳往来 Tab', async () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/index/index.wxml'), 'utf8');
  assert(wxml.includes('本月人情往来'), '小结条标题在');
  assert(wxml.includes('本月还没有记录'), '小结空态文案在');
  assert(wxml.includes('最近往来') && wxml.includes('查看全部'), '最近往来卡与查看全部在');
  assert(wxml.includes('wx:if="{{recent.length}}"'), '无记录时最近往来整卡不渲染');
  const js = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/index/index.js'), 'utf8');
  assert(js.includes('getHomeSummary') && js.includes('getHomeRecent'), '首页数据走 data-service 真接口');
  assert(js.includes("switchTab({ url: '/pages/wanglai/wanglai' })"), '查看全部跳往来 Tab');
  const wxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/index/index.wxss'), 'utf8');
  assert(wxss.includes('.month-bar') && wxss.includes('.recent-card'), '小结条与最近卡样式在');
});
