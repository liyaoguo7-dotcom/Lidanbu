/**
 * 全链路回环测试（任务AD）：小程序端 data-service（云模式）→ 远程 core 代理
 * → 注入传输 → 云函数 api 的 createMain（假 SDK）→ CloudDB（假云数据库）。
 * 等于把"小程序→云函数→数据库"整条链在进程内跑通；传输做 JSON 往返，
 * 与真实 wx.cloud.callFunction 的序列化行为对齐（能抓出错误码/原始错误
 * 在序列化中丢失这类问题）。
 *
 * 场景：init 以服务端 openid 建号 → 注册赠分 15 经服务端到账 → 建亲友 →
 * 建礼薄 → 记收礼 → 往来/礼薄统计有数 → 首页小结/最近往来有数 →
 * 导出概览与导出历史通 → 购买会员（服务端注入 Mock 适配器）到账赠分 →
 * 额度超限时云端与本地模式抛出同一句卖惨文案 → 传输失败时 init 优雅失败。
 */
const path = require('path');
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const { test, assert } = require('./fw');
const { makeFakeSdk } = require('./fake-cloud-sdk');
const core = require('../core');
const dataService = require('../miniprogram/services/data-service');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const apiCore = require(path.join(API_DIR, 'core'));
// eslint-disable-next-line import/no-dynamic-require
const { createMain } = require(path.join(API_DIR, 'index.js'));

/** 建一条回环：固定 openid 的假云端 + JSON 往返传输 */
function makeLoopback(openid) {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: openid });
  const db = new apiCore.db.CloudDB({ sdk });
  const main = createMain({ sdk, core: apiCore, db });
  const transport = async (data) => {
    const wireIn = JSON.parse(JSON.stringify(data));
    const res = await main(wireIn);
    return JSON.parse(JSON.stringify(res));
  };
  return { transport, sdk, db };
}

async function initCloud(openid) {
  const { transport } = makeLoopback(openid);
  dataService._resetForTest();
  dataService._setModeForTest('cloud');
  dataService._setTransportForTest(transport);
  const r = await dataService.init();
  assert(r.ok === true, `云模式 init 应成功（实际 ${JSON.stringify(r)}）`);
  return r;
}

test('回环：init 以服务端 openid 建号，注册赠分 15 经服务端到账', async () => {
  try {
    await initCloud('loop-user-1');
    assert.eq(dataService.userId, 'loop-user-1', '身份应为服务端 openid，不是本地演示 id');
    assert.eq(dataService.localMode, false, '云模式 localMode 为 false');
    const bal = await dataService.getPointsBalance();
    assert.eq(bal, 15, '注册赠分 15 应经服务端发放到账');
    const profile = await dataService.getProfile();
    assert.eq(profile.displayName, '微信用户', '新号无昵称显示"微信用户"');
  } finally { dataService._resetForTest(); }
});

test('回环：建亲友→建礼薄→记收礼→统计/首页/导出全通', async () => {
  try {
    await initCloud('loop-user-2');
    const c = await dataService.createContact({ name: '张三', remark: '同学' });
    const contactId = (c.contact && c.contact._id) || c._id;
    assert(contactId, '应拿到亲友 id');
    const ev = await dataService.createEvent({ name: '张三的婚礼', tagId: 'jiehun', date: '2026-10-01' });
    const eventId = (ev.event && ev.event._id) || ev._id;
    assert(eventId, '应拿到礼薄 id');
    await dataService.createRecord(eventId, {
      contactId, amountFen: 100000, type: '现金', date: '2026-10-01',
    });
    const stats = await dataService.getEventStats(eventId);
    assert.eq(stats.count, 1, '礼薄应有 1 条记录');
    assert.eq(stats.totalFen, 100000, '礼薄合计 100000 分');
    const wl = await dataService.getWanglaiList({});
    assert.eq(wl.rows.length, 1, '往来应有 1 位亲友');
    assert.eq(wl.totalReceiveFen, 100000, '往来收礼总额 100000 分');
    const summary = await dataService.getHomeSummary();
    assert(summary.hasRecords === true, '首页小结本月应有记录');
    assert.eq(summary.receiveFen, 100000, '首页小结收礼 100000 分');
    const recent = await dataService.getHomeRecent(3);
    assert.eq(recent.length, 1, '最近往来 1 条');
    assert.eq(recent[0].kind, 'receive', '最近往来为收礼');
    assert.eq(recent[0].amountText, '+1000.00', '金额两位小数字符串');
    const es = await dataService.exportSummary();
    assert.eq(es.events.length, 1, '导出概览礼薄 1 个');
    assert.eq(es.receiveRecords, 1, '导出概览收礼 1 条');
    assert.eq(es.contacts, 1, '导出概览亲友 1 位');
    await dataService.logExportJob('全部礼薄+送礼');
    const jobs = await dataService.listExportJobs();
    assert.eq(jobs.length, 1, '导出历史 1 条');
    assert.eq(jobs[0].scope, '全部礼薄+送礼', '导出历史 scope 一致');
  } finally { dataService._resetForTest(); }
});

test('回环：购买会员经服务端 Mock 适配器发货，赠分到账', async () => {
  try {
    await initCloud('loop-user-3');
    const r = await dataService.purchaseMembership('month');
    assert(r.delivered === true, '云模式购买应发货成功');
    const bal = await dataService.getPointsBalance();
    assert.eq(bal, 25, '注册 15 + 月卡赠 10 = 25 分');
    const m = await dataService.getMembership();
    assert.eq(m.state, 'member', '购买后应为会员');
    const orders = await dataService.listMyOrders();
    assert.eq(orders.length, 1, '应有 1 张订单');
    assert.eq(orders[0].status, 'paid', '订单已支付');
  } finally { dataService._resetForTest(); }
});

test('回环：额度超限文案与本地模式逐字一致（卖惨口径）', async () => {
  async function fourthEventMessage() {
    for (let i = 1; i <= 3; i++) {
      await dataService.createEvent({ name: `婚礼${i}`, tagId: 'jiehun', date: '2026-10-01' });
    }
    try {
      await dataService.createEvent({ name: '婚礼4', tagId: 'jiehun', date: '2026-10-01' });
      return null;
    } catch (e) { return e.message; }
  }
  let cloudMsg;
  let localMsg;
  try {
    await initCloud('loop-user-4');
    cloudMsg = await fourthEventMessage();
  } finally { dataService._resetForTest(); }
  try {
    dataService._resetForTest();
    dataService._setModeForTest('local');
    dataService._setDbFactoryForTest(() => new core.db.MemoryDB());
    const r = await dataService.init();
    assert(r.ok === true, '本地模式 init 应成功');
    localMsg = await fourthEventMessage();
  } finally { dataService._resetForTest(); }
  assert(cloudMsg && cloudMsg.includes('呜呜'), `云端超限应为卖惨文案（实际：${cloudMsg}）`);
  assert.eq(cloudMsg, localMsg, '云端与本地模式超限文案应逐字一致');
});

test('回环：传输失败时 init 优雅失败（不抛死）', async () => {
  try {
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(async () => { throw new Error('callFunction:fail timeout'); });
    const r = await dataService.init();
    assert(r.ok === false && r.reason === 'network', `应返回 network 失败（实际 ${JSON.stringify(r)}）`);
  } finally { dataService._resetForTest(); }
});
