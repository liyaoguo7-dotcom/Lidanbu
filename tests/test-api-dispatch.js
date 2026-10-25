/** api 云函数分发：假 SDK + 同步进云函数的 core 副本，在进程内跑通全链路
 * （等于把云端 api 提前在本地联调一遍；真云端只剩 SDK 本身的差异） */
const path = require('path');
const { makeFakeSdk } = require('./fake-cloud-sdk');
const { test, assert } = require('./fw');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const core = require(path.join(API_DIR, 'core'));
// eslint-disable-next-line import/no-dynamic-require
const { createMain } = require(path.join(API_DIR, 'index.js'));

function makeMain(openid, seedDoc) {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: openid });
  const db = new core.db.CloudDB({ sdk });
  const main = createMain({ sdk, core, db });
  if (seedDoc) {
    // 种 appConfig 单例（如开发布开关）；insert 须在首个业务调用前完成，
    // 用同步启动的 promise 串到 main 前——简单起见测试里直接 await 种子
    main.seedPromise = db.collection('appConfig').insert({ _id: 'singleton', ...seedDoc });
  }
  return main;
}

test('api分发：whoami 返回服务端 openid；未知 action 被拒', async () => {
  const main = makeMain('owner-1');
  const me = await main({ action: 'whoami' });
  assert(me.ok && me.data.openid === 'owner-1', 'whoami 应返回 OPENID');
  const bad = await main({ action: 'models.COLLECTIONS' });
  assert(bad.ok === false, '未开放模块应被拒');
  const bad2 = await main({ action: 'contacts.nope' });
  assert(bad2.ok === false, '不存在的函数应被拒');
});

test('api分发：亲友→礼薄→收礼→往来统计 全链路（服务端 core + CloudDB）', async () => {
  const main = makeMain('owner-2');
  const c = await main({ action: 'contacts.createContact', args: ['owner-2', { name: '张三', remark: '' }] });
  assert(c.ok, `建亲友失败：${c.error || ''}`);
  const contactId = (c.data.contact && c.data.contact._id) || c.data._id || c.data.id;
  assert(contactId, '应拿到亲友 ID');

  const ev = await main({ action: 'receive.createEvent', args: ['owner-2', { name: '张三的婚礼', tagId: 'wedding' }] });
  assert(ev.ok, `建礼薄失败：${ev.error || ''}`);
  const eventId = (ev.data.event && ev.data.event._id) || ev.data._id || ev.data.id;
  assert(eventId, '应拿到礼薄 ID');

  const rec = await main({
    action: 'receive.createRecord',
    args: ['owner-2', eventId, { contactId, amount: 100000, type: '现金' }],
  });
  assert(rec.ok, `记收礼失败：${rec.error || ''}`);

  const stats = await main({ action: 'stats.getWanglaiStats', args: ['owner-2', { preset: 'all' }] });
  assert(stats.ok, `统计失败：${stats.error || ''}`);
  assert.eq(stats.data.receiveTotal, 100000, '收礼总额应为 100000 分');
  assert.eq(stats.data.receiveCount, 1, '收礼 1 笔');
});

test('api分发：export.buildExportData 只读聚合（任务AD 放行 export 模块）', async () => {
  const main = makeMain('owner-3');
  const c = await main({ action: 'contacts.createContact', args: ['owner-3', { name: '李四', remark: '' }] });
  assert(c.ok, '建亲友应成功');
  const contactId = (c.data.contact && c.data.contact._id) || c.data._id || c.data.id;
  const ev = await main({ action: 'receive.createEvent', args: ['owner-3', { name: '李四的婚礼', tagId: 'jiehun' }] });
  assert(ev.ok, '建礼薄应成功');
  const eventId = (ev.data.event && ev.data.event._id) || ev.data._id || ev.data.id;
  const rec = await main({
    action: 'receive.createRecord',
    args: ['owner-3', eventId, { contactId, amount: 50000, type: '红包' }],
  });
  assert(rec.ok, '记收礼应成功');
  const sum = await main({ action: 'export.buildExportData', args: ['owner-3'] });
  assert(sum.ok, `概览聚合失败：${sum.error || ''}`);
  assert.eq(sum.data.events.length, 1, '礼薄 1 个');
  assert.eq(sum.data.receiveRecords, 1, '收礼 1 条');
  assert.eq(sum.data.gifts, 0, '送礼 0 条');
  assert.eq(sum.data.contacts, 1, '亲友 1 位');
});

test('api分发：importer 导出任务记录与列表（任务AD）', async () => {
  const main = makeMain('owner-4');
  const r = await main({ action: 'importer.recordExportJob', args: [{ scope: '全部礼薄+送礼' }] });
  assert(r.ok, `记导出历史失败：${r.error || ''}`);
  const list = await main({ action: 'importer.listExportJobs', args: [] });
  assert(list.ok, `读导出历史失败：${list.error || ''}`);
  assert.eq(list.data.length, 1, '导出历史 1 条');
  assert.eq(list.data[0].kind, 'export', 'kind 为 export');
  assert.eq(list.data[0].scope, '全部礼薄+送礼', 'scope 原样');
  assert.eq(list.data[0].status, 'done', 'status 为 done');
  // 他人读不到（按调用者 openid 过滤）
  const other = makeMain('owner-5');
  const empty = await other({ action: 'importer.listExportJobs', args: [] });
  assert(empty.ok && empty.data.length === 0, '他人导出历史应为空');
});

test('api分发：支付经服务端注入 Mock 适配器完成购买；错误码透传（任务AD；任务AF 后需开购买总开关）', async () => {
  const main = makeMain('owner-6', { payment: { enabled: true } });
  await main.seedPromise;
  const buy = await main({ action: 'payment.purchase', args: ['month', {}] });
  assert(buy.ok, `购买失败：${buy.error || ''}`);
  assert(buy.data.delivered === true, 'Mock 支付应发货成功');
  const bal = await main({ action: 'points.getBalance', args: [] });
  assert(bal.ok, '查余额应成功');
  assert.eq(bal.data, 25, '注册赠 15 + 月卡赠 10 = 25 分');
  const bad = await main({ action: 'payment.purchase', args: ['no-such-plan', {}] });
  assert(bad.ok === false, '不存在的档位应被拒');
  assert.eq(bad.code, 'plan-not-found', '信封应透传机器错误码 plan-not-found');
});

test('api分发：fontFile 服务端代取字体（白名单＋容器缓存＋非法 fileID 拒绝）', async () => {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: 'font-user' });
  let downloads = 0;
  sdk.downloadFile = async ({ fileID }) => {
    downloads += 1;
    assert(fileID.endsWith('.ttf'), '只应取 TTF');
    return { fileContent: Buffer.from('FONTBYTES') };
  };
  const db = new core.db.CloudDB({ sdk });
  const main = createMain({ sdk, core, db });
  const FID = 'cloud://cloud1-x.636c-bucket/fonts/mashanzheng.ttf';
  const r1 = await main({ action: 'fontFile', fileID: FID });
  assert(r1.ok === true, `代取应成功（实际 ${JSON.stringify(r1)}）`);
  assert.eq(r1.data.base64, Buffer.from('FONTBYTES').toString('base64'), '回的是文件 base64');
  const r2 = await main({ action: 'fontFile', fileID: FID });
  assert(r2.ok === true && downloads === 1, '同容器第二次应走缓存、不再下载');
  const bad = await main({ action: 'fontFile', fileID: 'cloud://cloud1-x.636c-bucket/fonts/evil.ttf' });
  assert(bad.ok === false && downloads === 1, '白名单外字体应被拒');
  const bad2 = await main({ action: 'fontFile', fileID: 'https://x.example/fonts/mashanzheng.ttf' });
  assert(bad2.ok === false, '非 cloud:// 形态应被拒');
  const bad3 = await main({ action: 'fontFile', fileID: 'cloud://cloud1-x.636c-bucket/other/mashanzheng.ttf' });
  assert(bad3.ok === false, 'fonts/ 目录外应被拒');
});

test('api分发 AL-7 注册闸：关注册后新号被拒（registration-closed），名单内新号放行', async () => {
  const main = makeMain('newbie-al7', { adminIds: ['boss-al7'], features: { registration: false } });
  await main.seedPromise;
  const blocked = await main({ action: 'contacts.createContact', args: ['newbie-al7', { name: '新人', remark: '' }] });
  assert(blocked.ok === false && blocked.code === 'registration-closed', `新号应被注册闸拒绝，实际 ${JSON.stringify(blocked)}`);
  const main2 = makeMain('boss-al7', { adminIds: ['boss-al7'], features: { registration: false } });
  await main2.seedPromise;
  const okBoss = await main2({ action: 'contacts.createContact', args: ['boss-al7', { name: '老板', remark: '' }] });
  assert(okBoss.ok, `管理员新号应放行，实际 ${JSON.stringify(okBoss)}`);
});

test('api分发 AL-7 维护闸：维护中非管理员停服（maintenance），管理员与状态查询放行', async () => {
  const seed = { adminIds: ['boss-al8'], features: { maintenance: true } };
  const main = makeMain('user-al8', seed);
  await main.seedPromise;
  const blocked = await main({ action: 'contacts.createContact', args: ['user-al8', { name: '路人', remark: '' }] });
  assert(blocked.ok === false && blocked.code === 'maintenance', `维护中应停服，实际 ${JSON.stringify(blocked)}`);
  const flags = await main({ action: 'features.getFlags', args: ['user-al8'] });
  assert(flags.ok && flags.data.maintenance === true, 'getFlags 应放行且报维护中');
  const main2 = makeMain('boss-al8', seed);
  await main2.seedPromise;
  const adm = await main2({ action: 'admin.isAdmin', args: ['boss-al8'] });
  assert(adm.ok, `管理员应不受维护闸影响，实际 ${JSON.stringify(adm)}`);
});
