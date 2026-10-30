/**
 * 全链路回环测试（任务AD）：小程序端 data-service（云模式）→ 远程 core 代理
 * → 注入传输 → 云函数 api 的 createMain（假 SDK）→ CloudDB（假云数据库）。
 * 等于把"小程序→云函数→数据库"整条链在进程内跑通；传输做 JSON 往返，
 * 与真实 wx.cloud.callFunction 的序列化行为对齐（能抓出错误码/原始错误
 * 在序列化中丢失这类问题）。
 *
 * 场景：init 以服务端 openid 建号 → 注册赠分 15 经服务端到账 → 建亲友 →
 * 建礼薄 → 记收礼 → 往来/礼薄统计有数 → 首页小结/最近往来有数 →
 * 导出概览与导出历史通 → 购买会员（服务端注入真适配器建单签名＋发货推送）到账赠分 →
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

async function initCloud(openid, seedDoc) {
  const { transport, db } = makeLoopback(openid);
  if (seedDoc) {
    // 种 appConfig 单例（任务AF 发布开关等）；须在 init 的首个业务调用前落库
    await db.collection('appConfig').insert({ _id: 'singleton', ...seedDoc });
  }
  dataService._resetForTest();
  dataService._setModeForTest('cloud');
  dataService._setTransportForTest(transport);
  // AR批：云模式拍照导入先上传云存储再启动任务，回环里用假上传模拟
  // wx.cloud.uploadFile（fileID 形状与假云 SDK 一致）
  dataService._setUploaderForTest(async (cloudPath) => `cloud://fake-env.fake-bucket/${cloudPath}`);
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
    assert(/^礼友\d{4}$/.test(profile.displayName), '新号无昵称显示按账号生成的昵称（BG批「礼友＋数字」）');
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

test('回环：购买会员经服务端真适配器建单签名，发货推送到账赠分', async () => {
  process.env.VIRTUAL_PAY_APP_KEY = 'test-app-key-abc';
  try {
    const { transport, db } = makeLoopback('loop-user-3');
    await db.collection('appConfig').insert({ _id: 'singleton', payment: { enabled: true } });
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(transport);
    dataService._setUploaderForTest(async (cloudPath) => `cloud://fake-env.fake-bucket/${cloudPath}`);
    const r0 = await dataService.init();
    assert(r0.ok === true, '云模式 init 应成功');
    const r = await dataService.purchaseMembership('month', { platform: 'android', sessionKey: 'test-session-key' });
    assert(r.pendingPay === true, '真适配器建单应返回待支付（不直接发货）');
    assert(r.payParams && r.payParams.paySig, '应返回签名');
    // 模拟平台发货推送（发货只认推送，不认前端回调）
    const delivered = await apiCore.payment.processNotify(db, new apiCore.payAdapter.WechatVirtualPayAdapter(), { Event: 'xpay_goods_deliver_notify', OutTradeNo: r.order.outTradeNo, WeChatPayInfo: { MchOrderNo: 'wx-test-002' } });
    assert(delivered.delivered === true, '发货推送应发货成功');
    const bal = await dataService.getPointsBalance();
    assert.eq(bal, 25, '注册 15 + 月卡赠 10 = 25 分');
    const m = await dataService.getMembership();
    assert.eq(m.state, 'member', '购买后应为会员');
    const orders = await dataService.listMyOrders();
    assert.eq(orders.length, 1, '应有 1 张订单');
    assert.eq(orders[0].status, 'paid', '订单已支付');
  } finally { dataService._resetForTest(); delete process.env.VIRTUAL_PAY_APP_KEY; }
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

test('回环：会员拍照导入送礼/收礼全通（任务AE 第 5 项链路坐实）', async () => {
  process.env.VIRTUAL_PAY_APP_KEY = 'test-app-key-abc';
  try {
    const { transport, db } = makeLoopback('loop-user-photo');
    await db.collection('appConfig').insert({ _id: 'singleton', payment: { enabled: true }, features: { photoImport: true } });
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(transport);
    dataService._setUploaderForTest(async (cloudPath) => `cloud://fake-env.fake-bucket/${cloudPath}`);
    const r0 = await dataService.init();
    assert(r0.ok === true, '云模式 init 应成功');
    // 先买会员：真适配器建单 + 发货推送到账（15 + 10 = 25 分）
    const buy = await dataService.purchaseMembership('month', { platform: 'android', sessionKey: 'test-session-key' });
    assert(buy.pendingPay === true, '建单应返回待支付');
    const delivered = await apiCore.payment.processNotify(db, new apiCore.payAdapter.WechatVirtualPayAdapter(), { Event: 'xpay_goods_deliver_notify', OutTradeNo: buy.order.outTradeNo, WeChatPayInfo: { MchOrderNo: 'wx-test-003' } });
    assert(delivered.delivered === true, '发货推送应发货成功');
    const g = await dataService.recognizePhoto('/tmp/p.jpg', 'gift', {});
    assert.eq(g.items.length, 3, '送礼识别返回 3 条（Mock 口径）');
    assert.eq(g.items.map((i) => i.name).join(','), '张三,李五,王二麻', '条目顺序原样透传（顺序契约：适配层不得重排）');
    assert.eq(g.cost, 5, '拍照单价 5 分');
    const ev = await dataService.createEvent({ name: '拍照礼薄', tagId: 'jiehun', date: '2026-10-23' });
    const evId = (ev.event && ev.event._id) || ev._id;
    const r = await dataService.recognizePhoto('/tmp/p.jpg', 'receive', { eventId: evId });
    assert.eq(r.items.length, 2, '收礼识别返回 2 条（Mock 口径）');
    assert.eq(await dataService.getPointsBalance(), 15, '两次识别各扣 5 分：25 − 5 − 5 = 15');
  } finally { dataService._resetForTest(); delete process.env.VIRTUAL_PAY_APP_KEY; }
});

test('回环：免费用户拍照被会员门禁拦下，code 透传到页面层', async () => {
  try {
    await initCloud('loop-user-photo-free', { features: { photoImport: true } }); // 任务AF：只开拍照闸，验会员门禁（购买闸保持关）
    let caught = null;
    try { await dataService.recognizePhoto('/tmp/p.jpg', 'gift', {}); } catch (e) { caught = e; }
    assert(caught, '免费用户拍照应抛错');
    assert.eq(caught.code, 'member-required', '错误码 member-required 须透传（页面据此弹会员提示）');
    assert.eq(await dataService.getPointsBalance(), 15, '门禁拦下不扣分');
  } finally { dataService._resetForTest(); }
});

test('回环：带码错误文案不再被 friendly 吞成「操作失败」（任务AE 硬化）', async () => {
  try {
    await initCloud('loop-user-coded');
    const summary = await dataService.getInviteSummary();
    assert(summary.inviteCode, '应拿到自己的邀请码');
    let caught = null;
    try { await dataService.bindInviteCode(summary.inviteCode); } catch (e) { caught = e; }
    assert(caught, '绑自己的码应抛错');
    assert.eq(caught.message, '不能填写自己的邀请码哦', 'invite-self 文案应原样到达页面（旧口径会被吞成"操作失败，请重试"）');
  } finally { dataService._resetForTest(); }
});

test('回环：云端导出全链路返回 fileId（任务AE：修"云端未返回文件"）', async () => {
  try {
    await initCloud('loop-user-export');
    const ev = await dataService.createEvent({ name: '导出礼薄', tagId: 'jiehun', date: '2026-10-01' });
    const evId = (ev.event && ev.event._id) || ev._id;
    const out = await dataService.exportXlsx({ eventIds: [evId], includeGifts: true });
    assert(out && typeof out.fileId === 'string' && out.fileId.startsWith('cloud://fake-env.fake-bucket/exports/loop-user-export/'),
      `dataService 应解信封后回 fileId（实际 ${JSON.stringify(out)}）`);
    assert.eq(out.fileName, '礼单簿导出.xlsx', '展示文件名');
    const jobs = await dataService.listExportJobs();
    assert(jobs.length >= 1, '服务端应已写导出历史');
  } finally { dataService._resetForTest(); }
});

test('回环：礼薄列表一次取齐（listEventsWithStats 云端通路＋聚合正确）', async () => {
  try {
    await initCloud('loop-user-sum');
    const c = await dataService.createContact({ name: '王五' });
    const contactId = (c.contact && c.contact._id) || c._id;
    const ev = await dataService.createEvent({ name: '王五婚宴', tagId: 'jiehun', date: '2026-10-01' });
    const eventId = (ev.event && ev.event._id) || ev._id;
    await dataService.createRecord(eventId, { contactId, amountFen: 30000, type: '现金', date: '2026-10-01' });
    await dataService.createRecord(eventId, { contactId, amountFen: 20000, type: '红包', date: '2026-10-01' });
    await dataService.createEvent({ name: '空本', tagId: 'qita', date: '2026-10-03' });
    // 云模式下该方法经 remote-core 映射到服务端 receive.listEventSummaries；
    // 映射漏登记时这里会直接抛「操作失败」（2026-10-24 boot-sim 实锤过的坑）
    const sums = await dataService.listEventsWithStats();
    assert.eq(sums.length, 2, '两本礼薄');
    const byName = Object.fromEntries(sums.map((s) => [s.name, s]));
    assert.eq(byName['王五婚宴'].count, 2, '婚宴 2 条');
    assert.eq(byName['王五婚宴'].totalFen, 50000, '婚宴合计 500 元');
    assert.eq(byName['空本'].count, 0, '空本 0 条');
  } finally { dataService._resetForTest(); }
});

test('回环：remote-core 映射清单与本地 core 导出对齐（防漏登记）', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'miniprogram/services/remote-core.js'), 'utf8');
  const re = /makeRemoteModule\(t, '([a-zA-Z]+)', \[([^\]]+)\]\)/g;
  let m; let checked = 0;
  while ((m = re.exec(src)) !== null) {
    const mod = core[m[1]];
    assert(mod, `core 应有模块 ${m[1]}`);
    const names = [...m[2].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1]);
    for (const fn of names) {
      assert.eq(typeof mod[fn], 'function', `core.${m[1]}.${fn} 应存在（remote-core 已登记）`);
      checked += 1;
    }
  }
  assert(checked > 40, `应对齐检查应覆盖主要映射（实际 ${checked}）`);
});

test('回环：管理员增减通路（云端管理员调 addAdmin，错误原样回传）', async () => {
  try {
    await initCloud('loop-boss', { adminIds: ['loop-boss'] });
    let err = null;
    try { await dataService.adminAddAdmin('zzz***zzz'); } catch (e) { err = e; }
    assert(err && /没有找到这个编号对应的用户/.test(err.message), `不存在的编号应回可读错误（实际 ${err && err.message}）`);
    const list = await dataService.adminListAdmins();
    assert.eq(list.count, 1, '名单 1 人');
    assert.eq(list.admins[0].tier, 'console', '种子管理员是云端档');
    assert.eq(list.viewerCanManage, true, '云端管理员可增减');
  } finally { dataService._resetForTest(); }
});

test('回环：详情页一趟取齐（RPC 计数：详情聚合各只走 1 趟）', async () => {
  const { transport, sdk, db } = makeLoopback('loop-perf');
  let calls = 0;
  const counting = async (data) => { calls += 1; return transport(data); };
  try {
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(counting);
    const r = await dataService.init();
    assert(r.ok === true, 'init 应成功');
    const c = await dataService.createContact({ name: '李四' });
    const contactId = (c.contact && c.contact._id) || c._id;
    const ev = await dataService.createEvent({ name: '李四婚宴', tagId: 'jiehun', date: '2026-10-01' });
    const eventId = (ev.event && ev.event._id) || ev._id;
    const rec = await dataService.createRecord(eventId, { contactId, amountFen: 66000, type: '微信', date: '2026-10-01' });
    const recordId = (rec.record && rec.record._id) || rec._id;
    const gf = await dataService.createGift({ contactId, tagId: 'shengri', amountFen: 20000, date: '2026-09-01' });
    const giftId = (gf.gift && gf.gift._id) || gf._id;

    calls = 0;
    const ed = await dataService.getEventDetail(eventId);
    assert.eq(calls, 1, `礼薄详情应只走 1 趟（实际 ${calls}）`);
    assert(ed && ed.event && ed.count === 1 && ed.totalFen === 66000, '礼薄详情数据齐');
    assert.eq(ed.records[0].contactName, '李四', '明细带联系人名');

    calls = 0;
    const rd = await dataService.getRecordDetail(recordId);
    assert.eq(calls, 1, `收礼记录详情应只走 1 趟（实际 ${calls}）`);
    assert(rd && rd.contact && rd.contact.name === '李四' && rd.event && rd.event.name === '李四婚宴', '记录详情三件齐');

    calls = 0;
    const gd = await dataService.getGiftDetail(giftId);
    assert.eq(calls, 1, `送礼详情应只走 1 趟（实际 ${calls}）`);
    assert(gd && gd.contactName === '李四', '送礼详情带联系人名');
    void sdk; void db;
  } finally { dataService._resetForTest(); }
});

test('回环：保存后列表即时显示（会话缓存写穿，二次读列表 0 往返）', async () => {
  const { transport } = makeLoopback('loop-cache');
  let calls = 0;
  const counting = async (data) => { calls += 1; return transport(data); };
  try {
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(counting);
    await dataService.init();

    // 联系人：首读 1 趟、再读 0 趟；新建后列表立刻有（写穿）
    await dataService.listContacts();
    calls = 0;
    await dataService.listContacts();
    assert.eq(calls, 0, '联系人列表二次读取应走缓存');
    const c = await dataService.createContact({ name: '赵六' });
    const contactId = (c.contact && c.contact._id) || c._id;
    calls = 0;
    const afterAdd = await dataService.listContacts();
    assert.eq(calls, 0, '新建联系人后列表不应再等云端');
    assert(afterAdd.some((x) => x._id === contactId && x.name === '赵六'), '新联系人应已在列表');

    // 送礼：新建后列表立刻有
    await dataService.listGifts();
    const gf = await dataService.createGift({ contactId, tagId: 'shengri', amountFen: 10000, date: '2026-10-01' });
    const giftId = (gf.gift && gf.gift._id) || gf._id;
    calls = 0;
    const gifts = await dataService.listGifts();
    assert.eq(calls, 0, '新建送礼后列表不应再等云端');
    assert(gifts.some((g) => g._id === giftId), '新送礼应已在列表最上方');
    assert.eq(gifts[0]._id, giftId, '最新一条在最上方');

    // 礼薄汇总：记一笔后条数/合计即时更新
    const ev = await dataService.createEvent({ name: '赵六婚宴', tagId: 'jiehun', date: '2026-10-02' });
    const eventId = (ev.event && ev.event._id) || ev._id;
    await dataService.listEventsWithStats();
    await dataService.createRecord(eventId, { contactId, amountFen: 50000, type: '现金', date: '2026-10-02' });
    calls = 0;
    const sums = await dataService.listEventsWithStats();
    assert.eq(calls, 0, '记账后礼薄列表不应再等云端');
    const row = sums.find((s) => s._id === eventId);
    assert(row && row.count === 1 && row.totalFen === 50000, '礼薄条数/合计应即时更新');

    // 礼薄详情：首读落缓存；再记一笔，详情写穿即时可见
    const det1 = await dataService.getEventDetail(eventId);
    assert.eq(det1.count, 1, '详情首读 1 条');
    await dataService.createRecord(eventId, { contactId, amountFen: 30000, type: '红包', date: '2026-10-02' });
    calls = 0;
    const det2 = await dataService.getEventDetail(eventId);
    assert.eq(calls, 0, '详情再读应走缓存');
    assert(det2.count === 2 && det2.totalFen === 80000, '详情应写穿新记录');
    assert.eq(det2.records[0].contactName, '赵六', '新记录带联系人名');
  } finally { dataService._resetForTest(); }
});

test('回环：往来列表一趟取齐（逐人往返已消除）＋与逐人统计等价', async () => {
  const { transport, db } = makeLoopback('loop-wanglai');
  let calls = 0;
  const counting = async (data) => { calls += 1; return transport(data); };
  try {
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(counting);
    await dataService.init();
    const ids = [];
    for (const name of ['王五', '李四', '赵六']) {
      const c = await dataService.createContact({ name });
      ids.push((c.contact && c.contact._id) || c._id);
    }
    const ev = await dataService.createEvent({ name: '王五婚宴', tagId: 'jiehun', date: '2026-10-01' });
    const eventId = (ev.event && ev.event._id) || ev._id;
    await dataService.createRecord(eventId, { contactId: ids[0], amountFen: 88800, type: '微信', date: '2026-10-01' });
    await dataService.createGift({ contactId: ids[0], tagId: 'shengri', amountFen: 20000, date: '2026-09-01' });
    await dataService.createGift({ contactId: ids[1], tagId: 'shengri', amountFen: 6600, date: '2026-09-02' });

    calls = 0;
    const list = await dataService.getWanglaiList({});
    assert.eq(calls, 1, `往来列表应只走 1 趟（实际 ${calls}，旧实现=联系人数+1 趟）`);
    assert.eq(list.rows.length, 2, '有往来的联系人才入表');
    const w = list.rows.find((r) => r.contactId === ids[0]);
    assert(w && w.receiveFen === 88800 && w.giftFen === 20000 && w.count === 2, '王五行金额/笔数正确');
    assert.eq(list.totalReceiveFen, 88800, '总收正确');
    assert.eq(list.totalGiftFen, 26600, '总送正确');

    // （等价性由 core 层 test-wanglai 的逐人组装对照守恒）

    // 本人缓存：再读 0 趟；记一笔后作废重取且数字更新
    calls = 0;
    await dataService.getWanglaiList({});
    assert.eq(calls, 0, '往来列表二次读取应走缓存');
    await dataService.createGift({ contactId: ids[2], tagId: 'shengri', amountFen: 100, date: '2026-09-03' });
    const list2 = await dataService.getWanglaiList({});
    assert(list2.rows.some((r) => r.contactId === ids[2]), '新记录应让往来表作废重取并包含赵六');
  } finally { dataService._resetForTest(); }
});

// 回环服务端 db 适配：makeLoopback 的 db 即云端桩，core 直连需内存适配——
// 这里直接复用 createMemoryDb 无法拿到同一份数据，故仅在有桥时用；无桥则跳过直连核对。
function dbAdapterForLoop() { return null; }

test('回环：往来明细会话缓存（首开在途去重、再开零往返、写后作废）', async () => {
  const { transport } = makeLoopback('loop-timeline-cache');
  let calls = 0;
  const counting = async (data) => { calls += 1; return transport(data); };
  try {
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    dataService._setTransportForTest(counting);
    const r = await dataService.init();
    assert(r.ok === true, 'init 应成功');
    const c = await dataService.createContact({ name: '缓存测试' });
    const contactId = (c.contact && c.contact._id) || c._id;
    await dataService.createGift({ contactId, tagId: 'shengri', amountFen: 10000, date: '2026-09-01' });

    calls = 0;
    // 模拟页面 onLoad 与 onShow 首开各调一次（并发）：只应有一批往返（明细+联系人=2 趟）
    const [t1, t2] = await Promise.all([
      dataService.getTimeline({ contactId }),
      dataService.getTimeline({ contactId }),
    ]);
    assert.eq(calls, 2, `首开并发两调应去重为一批 2 趟（实际 ${calls}）`);
    assert(t1.items.length === 1 && t2.items.length === 1, '两次结果都应有那条送礼');

    const t3 = await dataService.getTimeline({ contactId });
    assert.eq(calls, 2, '再开应命中缓存、零往返');
    assert(t3.items.length === 1, '缓存结果正确');

    await dataService.createGift({ contactId, tagId: 'qiaoqian', amountFen: 20000, date: '2026-09-02' });
    calls = 0;
    const t4 = await dataService.getTimeline({ contactId });
    assert.eq(calls, 2, '写操作后缓存作废、重新取一批');
    assert.eq(t4.items.length, 2, '新数据应有 2 条');
  } finally { dataService._resetForTest(); }
});
