/**
 * 任务AF · 第一版发布口径回环测试：
 * - 云端购买默认关闭：普通用户购买被拒（不建单、不发货、不赠分、会员状态不变）；
 * - 管理员不受总闸限制：模拟购买成功且订单标 mock；
 * - 打开 payment.enabled 后普通用户可买（仍是模拟渠道、订单标 mock）；
 * - 拍照导入默认关闭：页面开关读取为关、服务端识别与确认写入双拒；
 * - 伪造他人 userId 的删除请求被服务端权限拒绝，受害者数据完好；
 * - 老板平台入口判定：isAdmin 只认服务端名单；「我的」页版本连点静态守门；
 * - 发布开关老板平台可改：getConfig 可见、updateLaunchSwitches 生效、非管理员改被拒；
 * - api 定时保活触发器：timer 事件空转返回 warm；config.json 带 timer 触发器。
 */
const fs = require('fs');
const path = require('path');
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const { test, assert } = require('./fw');
const { makeFakeSdk } = require('./fake-cloud-sdk');
const dataService = require('../miniprogram/services/data-service');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const apiCore = require(path.join(API_DIR, 'core'));
// eslint-disable-next-line import/no-dynamic-require
const { createMain } = require(path.join(API_DIR, 'index.js'));

function makeLoopback(openid) {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: openid });
  const db = new apiCore.db.CloudDB({ sdk });
  const main = createMain({ sdk, core: apiCore, db });
  const transport = async (data) => {
    const res = await main(JSON.parse(JSON.stringify(data)));
    return JSON.parse(JSON.stringify(res));
  };
  return { transport, sdk, db, main };
}

async function initCloud(openid, seedDoc) {
  const lb = makeLoopback(openid);
  if (seedDoc) {
    await lb.db.collection('appConfig').insert({ _id: 'singleton', ...seedDoc });
  }
  dataService._resetForTest();
  dataService._setModeForTest('cloud');
  dataService._setTransportForTest(lb.transport);
  const r = await dataService.init();
  assert(r.ok === true, `云模式 init 应成功（实际 ${JSON.stringify(r)}）`);
  return lb;
}

async function expectThrow(fn, textPart, label) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert(err, `${label}：应抛错`);
  assert(String(err.message).includes(textPart), `${label}：文案应含「${textPart}」（实际「${err.message}」）`);
  return err;
}

test('AF发布口径：云端普通用户购买被拒——不建单、不赠分、会员不变', async () => {
  try {
    await initCloud('af-user-1');
    assert.eq(await dataService.getPointsBalance(), 15, '注册赠分 15');
    await expectThrow(() => dataService.purchaseMembership('month'), '会员购买暂未开放，敬请期待', '买月卡应被总闸拒');
    await expectThrow(() => dataService.purchasePointsPack('pack10'), '会员购买暂未开放，敬请期待', '买积分包应被总闸拒（先于会员门禁）');
    assert.eq(await dataService.getPointsBalance(), 15, '被拒后余额不变');
    const orders = await dataService.listMyOrders();
    assert.eq(orders.length, 0, '被拒不产生订单');
  } finally { dataService._resetForTest(); }
});

test('AF发布口径：管理员模拟购买成功、订单标 mock、会员生效', async () => {
  try {
    await initCloud('af-admin-1', { adminIds: ['af-admin-1'] });
    assert.eq(await dataService.isAdmin(), true, '名单内应判管理员');
    const r = await dataService.purchaseMembership('month');
    assert(r && r.delivered === true, '管理员购买应发货');
    const orders = await dataService.listMyOrders();
    assert.eq(orders.length, 1, '应有 1 张订单');
    assert.eq(orders[0].mock, true, '模拟渠道订单应标 mock');
    assert.eq(await dataService.getPointsBalance(), 25, '注册 15 + 月卡赠 10');
  } finally { dataService._resetForTest(); }
});

test('AF发布口径：打开 payment.enabled 后普通用户可买（仍标 mock）', async () => {
  try {
    await initCloud('af-user-2', { payment: { enabled: true } });
    const r = await dataService.purchaseMembership('year');
    assert(r && r.delivered === true, '开闸后应购买成功');
    const orders = await dataService.listMyOrders();
    assert.eq(orders[0].mock, true, '真实支付接入前渠道仍是模拟、订单标 mock');
    assert.eq(await dataService.getPointsBalance(), 15 + 100, '年卡赠 100 分到账');
  } finally { dataService._resetForTest(); }
});

test('AF发布口径：拍照默认关——开关读取为关、识别与写入服务端双拒', async () => {
  try {
    await initCloud('af-user-3');
    const flags = await dataService.getFeatureFlags();
    assert.eq(flags.photoImport, false, '拍照开关默认关');
    await expectThrow(() => dataService.recognizePhoto('fake/path.jpg', 'gift'), '拍照导入敬请期待', '识别应被服务端拒');
    await expectThrow(
      () => dataService.importWrite({ kind: 'gift', items: [{ name: '张三', amountFen: 10000 }], jobId: 'job-af-1' }),
      '拍照导入敬请期待', '确认写入应被服务端拒');
  } finally { dataService._resetForTest(); }
});

test('AF发布口径：伪造他人 userId 删除亲友被拒、受害者数据完好', async () => {
  // 同一云端、同一 main：先以受害者身份建亲友，再切换 OPENID 为攻击者，
  // 在参数里伪造 ownerId=受害者 —— 服务端只认 OPENID 为 actor，权限应拒。
  const sdk2 = makeFakeSdk();
  let current = 'af-victim2';
  sdk2.getWXContext = () => ({ OPENID: current });
  const db2 = new apiCore.db.CloudDB({ sdk: sdk2 });
  const main2 = createMain({ sdk: sdk2, core: apiCore, db: db2 });
  const c2 = await main2({ action: 'contacts.createContact', args: ['af-victim2', { name: '赵六', remark: '' }] });
  const cid2 = (c2.data.contact && c2.data.contact._id) || c2.data._id;
  current = 'af-attacker2'; // 切换为攻击者身份，伪造 ownerId=受害者
  const del = await main2({ action: 'contacts.deleteContact', args: ['af-victim2', cid2, true] });
  assert(del.ok === false, '伪造 ownerId 的删除应被拒');
  current = 'af-victim2';
  const list = await main2({ action: 'contacts.listContacts', args: ['af-victim2'] });
  assert(list.ok && list.data.some((x) => x._id === cid2), '受害者亲友应完好无损');
});

test('AF发布口径：isAdmin 只认服务端名单；版本连点静态守门', async () => {
  try {
    await initCloud('af-user-4');
    assert.eq(await dataService.isAdmin(), false, '名单外不是管理员');
  } finally { dataService._resetForTest(); }
  const mine = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/mine/mine.js'), 'utf8');
  const tapFn = mine.slice(mine.indexOf('onVersionTap()'));
  assert(tapFn.startsWith('onVersionTap() {\n    if (!this._isAdmin) return;'), '版本连点第一行应为管理员判定守门');
  const tapBody = tapFn.slice(0, tapFn.indexOf('\n  },'));
  assert(!/showToast|showModal/.test(tapBody), '非管理员连点不得出现任何提示');
  assert(/this\._isAdmin = await dataService\.isAdmin\(\)/.test(mine), '入口显隐应由服务端判定结果驱动');
});

test('AF发布口径：老板平台可见发布开关、可改、非管理员改被拒', async () => {
  try {
    await initCloud('af-admin-2', { adminIds: ['af-admin-2'] });
    const cfg = await dataService.adminGetConfig();
    assert.eq(cfg.paymentEnabled, false, '老板平台应可见云端购买开关（默认关）');
    assert.eq(cfg.photoImportEnabled, false, '老板平台应可见拍照开关（默认关）');
    const r = await dataService.adminUpdateLaunchSwitches({ paymentEnabled: true });
    assert.eq(r.paymentEnabled, true, '改后应返回开');
    const cfg2 = await dataService.adminGetConfig();
    assert.eq(cfg2.paymentEnabled, true, '购买开关应已落库生效');
    assert.eq(cfg2.photoImportEnabled, false, '未改的拍照开关保持关');
  } finally { dataService._resetForTest(); }
  try {
    await initCloud('af-user-5');
    await expectThrow(() => dataService.adminUpdateLaunchSwitches({ paymentEnabled: true }), '无权限', '非管理员改开关应被拒');
  } finally { dataService._resetForTest(); }
});

test('AF发布口径：首页请柬未配置整隐藏、拍照入口先过总闸（静态）', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/index/index.js'), 'utf8');
  assert(/entries\.filter\(\(e\) => e\.id !== 'invite'\)/.test(idx), 'AppID 未配置时请柬入口应整条过滤');
  const photoGateAt = idx.indexOf('拍照导入敬请期待');
  const memberOnlyAt = idx.indexOf('memberOnly(id)');
  assert(photoGateAt > 0 && memberOnlyAt > photoGateAt, '拍照入口应先过功能总闸、再走会员判断');
});

test('AF性能：api 定时保活触发器——timer 事件空转、config.json 已配', async () => {
  const lb = makeLoopback('af-warm');
  const r = await lb.main({ Type: 'timer', TriggerName: 'warmupTimer' });
  assert(r.ok === true && r.warm === true, 'timer 事件应空转返回 warm');
  const cfg = JSON.parse(fs.readFileSync(path.join(API_DIR, 'config.json'), 'utf8'));
  assert(Array.isArray(cfg.triggers) && cfg.triggers.some((t) => t.type === 'timer'), 'api config.json 应带 timer 触发器');
});
