/**
 * AR批行为测试：拍照导入照片送达缺口修复（云模式先上传、任务只收 fileID）。
 * ① 云模式单张：上传在启动任务之前发生、任务入参只带 imageFileIds 不带本地路径；
 * ② 云模式多张：上传与 fileID 数组保序、识别结果按序拼接、整批只扣一次；
 * ③ 上传失败：明确报错、不启动任务、不扣分；
 * ④ 本地演示模式：不上传、仍走 imagePath，结果与口径不变、无 photoFileIds；
 * ⑤ core：imageFileIds 逐张识别保序拼接、只扣一次；任一张失败整批不扣费；
 * ⑥ 清理钩子 cleanupImportPhotos：仅云模式且有 fileID 时删除。
 * 全部进程内打桩（假 SDK/回环传输/假上传删除），绝不真连网、绝不真上传。
 */
const path = require('path');
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const { test, assert } = require('./fw');
const { makeFakeSdk } = require('./fake-cloud-sdk');
const h = require('./helpers');
const core = require('../core');
const dataService = require('../miniprogram/services/data-service');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const apiCore = require(path.join(API_DIR, 'core'));
// eslint-disable-next-line import/no-dynamic-require
const { createMain } = require(path.join(API_DIR, 'index.js'));

const { COLLECTIONS } = core.models;
const importer = core.importer;
const points = core.points;

/* ---------- 云回环脚手架（与 test-cloud-loopback 同形，另带事件/调用记录） ---------- */

function makeLoopback(openid, events) {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: openid });
  const db = new apiCore.db.CloudDB({ sdk });
  const main = createMain({ sdk, core: apiCore, db });
  const calls = [];
  const transport = async (data) => {
    calls.push(data);
    if (events) events.push(`rpc:${data.action}`);
    const wireIn = JSON.parse(JSON.stringify(data));
    const res = await main(wireIn);
    return JSON.parse(JSON.stringify(res));
  };
  return { transport, db, calls };
}

async function initCloudAr(openid, { events, uploader } = {}) {
  const { transport, db, calls } = makeLoopback(openid, events);
  // 验识别链路故开闸：购买总开关 + 拍照总闸（任务AF 两开关默认关）
  await db.collection('appConfig').insert({
    _id: 'singleton', payment: { enabled: true }, features: { photoImport: true },
  });
  dataService._resetForTest();
  dataService._setModeForTest('cloud');
  dataService._setTransportForTest(transport);
  if (uploader) dataService._setUploaderForTest(uploader);
  const r = await dataService.init();
  assert(r.ok === true, `云模式 init 应成功（实际 ${JSON.stringify(r)}）`);
  return { calls };
}

function recordingUploader(events, uploads) {
  return async (cloudPath, filePath) => {
    if (events) events.push('upload');
    uploads.push({ cloudPath, filePath });
    return `cloud://fake-env.fake-bucket/${cloudPath}`;
  };
}

/* ---------- ① 云模式单张：先上传后启动、入参只有 fileID ---------- */

test('AR 云模式：先上传后启动任务，入参带 imageFileIds 不带本地路径', async () => {
  try {
    const events = [];
    const uploads = [];
    const { calls } = await initCloudAr('ar-user-1', { events, uploader: recordingUploader(events, uploads) });
    await dataService.purchaseMembership('month'); // 会员 + 25 分
    events.length = 0;
    calls.length = 0;
    const r = await dataService.recognizePhoto('/tmp/ar-p1.jpg', 'gift', {});
    assert.eq(uploads.length, 1, '应上传 1 张');
    assert.eq(uploads[0].filePath, '/tmp/ar-p1.jpg', '上传的应是用户选的那张本地照片');
    assert(
      /^ocr-imports\/\d+-[a-z0-9]+-0\.jpg$/.test(uploads[0].cloudPath),
      `云路径应为 ocr-imports/ 前缀+时间戳+随机段+序号（实际 ${uploads[0].cloudPath}）`,
    );
    const upIdx = events.indexOf('upload');
    const rpcIdx = events.indexOf('rpc:importer.startImportTask');
    assert(upIdx !== -1 && rpcIdx !== -1 && upIdx < rpcIdx, '上传必须发生在启动导入任务之前');
    const startCall = calls.find((c) => c.action === 'importer.startImportTask');
    assert(startCall, '应发出 startImportTask 调用');
    const wire = JSON.stringify(startCall.args);
    assert(wire.includes('"imageFileIds"'), '任务入参应带 imageFileIds');
    assert(wire.includes('cloud://fake-env.fake-bucket/ocr-imports/'), '任务入参应带上传得到的 fileID');
    assert(!wire.includes('/tmp/ar-p1.jpg'), '任务入参绝不能带本地临时路径（云端取不到）');
    assert(!wire.includes('"imagePath"'), '云模式任务入参不应再带 imagePath');
    assert.eq(r.items.length, 3, '识别结果仍为 Mock 送礼 3 条（服务端选择逻辑未变）');
    assert.eq(r.cost, 5, '识别成功仍扣 5 分');
    assert.eq(r.photoFileIds.length, 1, '结果应回带 photoFileIds 供核对页清理');
    assert.eq(r.photoFileIds[0], `cloud://fake-env.fake-bucket/${uploads[0].cloudPath}`, 'photoFileIds 应为上传得到的 fileID');
  } finally { dataService._resetForTest(); }
});

/* ---------- ② 云模式多张：保序、拼接、只扣一次 ---------- */

test('AR 云模式多张：上传与 fileID 保序、结果按序拼接、整批只扣一次', async () => {
  try {
    const uploads = [];
    await initCloudAr('ar-user-2', { uploader: recordingUploader(null, uploads) });
    await dataService.purchaseMembership('month'); // 25 分
    const r = await dataService.recognizePhoto(['/tmp/ar-a.jpg', '/tmp/ar-b.jpg'], 'gift', {});
    assert.eq(uploads.length, 2, '应按序上传 2 张');
    assert.eq(uploads[0].filePath, '/tmp/ar-a.jpg', '第一张先传');
    assert.eq(uploads[1].filePath, '/tmp/ar-b.jpg', '第二张后传');
    assert(uploads[0].cloudPath.endsWith('-0.jpg') && uploads[1].cloudPath.endsWith('-1.jpg'), '云路径序号应与拍照顺序一致');
    assert.eq(r.photoFileIds.length, 2, 'photoFileIds 应有 2 个');
    assert.eq(r.photoFileIds[0], `cloud://fake-env.fake-bucket/${uploads[0].cloudPath}`, 'fileID 顺序与上传顺序一致（1）');
    assert.eq(r.photoFileIds[1], `cloud://fake-env.fake-bucket/${uploads[1].cloudPath}`, 'fileID 顺序与上传顺序一致（2）');
    assert.eq(r.items.length, 6, '两张识别结果按序拼接 3+3');
    assert.eq(
      r.items.map((i) => i.name).join(','),
      '张三,李五,王二麻,张三,李五,王二麻',
      '拼接顺序 = 拍照顺序',
    );
    assert.eq(await dataService.getPointsBalance(), 20, '整批只扣一次：25 − 5 = 20');
  } finally { dataService._resetForTest(); }
});

/* ---------- ③ 上传失败：不启动任务、不扣分 ---------- */

test('AR 云模式上传失败：明确报错、不启动任务、不扣分', async () => {
  try {
    const { calls } = await initCloudAr('ar-user-3', {
      uploader: async () => { throw new Error('uploadFile:fail 网络断开'); },
    });
    await dataService.purchaseMembership('month'); // 25 分
    calls.length = 0;
    let caught = null;
    try { await dataService.recognizePhoto('/tmp/ar-fail.jpg', 'gift', {}); } catch (e) { caught = e; }
    assert(caught, '上传失败应抛错');
    assert(/照片上传失败/.test(caught.message), `应明确报上传失败（实际：${caught && caught.message}）`);
    assert(
      !calls.some((c) => c.action === 'importer.startImportTask'),
      '上传失败绝不能启动导入任务',
    );
    assert.eq(await dataService.getPointsBalance(), 25, '上传失败不扣分');
  } finally { dataService._resetForTest(); }
});

/* ---------- ④ 本地模式：不上传、行为不变 ---------- */

test('AR 本地模式：不上传云存储、仍走本地路径识别、无 photoFileIds', async () => {
  try {
    const memDb = new core.db.MemoryDB();
    let uploads = 0;
    dataService._resetForTest();
    dataService._setDbFactoryForTest(() => memDb);
    dataService._setUploaderForTest(async () => { uploads += 1; return 'cloud://should/not-be-used'; });
    const r0 = await dataService.init();
    assert(r0.ok === true, '本地模式 init 应成功');
    const uid = dataService.userId;
    assert(uid, '应有本地用户 id');
    // 把本地用户提成会员并充值（只动测试库，不影响断言口径）
    await memDb.collection(COLLECTIONS.User).update(
      { _id: uid },
      { membership: { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null } },
    );
    await points.grant(memDb, uid, 100, { kind: 'manual', refId: 'ar-local-seed', note: '测试充值' });
    const r = await dataService.recognizePhoto('/tmp/ar-local.jpg', 'gift', {});
    assert.eq(uploads, 0, '本地演示模式绝不上传');
    assert.eq(r.items.length, 3, '本地识别仍走 Mock 送礼 3 条');
    assert.eq(r.cost, 5, '本地识别成功仍扣 5 分');
    assert.eq(r.photoFileIds.length, 0, '本地模式没有云端照片可清理');
  } finally { dataService._resetForTest(); }
});

/* ---------- ⑤ core：imageFileIds 逐张保序、只扣一次；一张失败整批不扣 ---------- */

const MEMBER = () => ({ status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });

async function memberWithPoints(db, id, balance) {
  const owner = await h.newUser(db, id, MEMBER());
  if (balance > 0) {
    await points.grant(db, owner, balance, { kind: 'manual', refId: `seed:${id}`, note: '测试充值' });
  }
  return owner;
}

async function spendCount(db, userId) {
  const all = await db.collection(COLLECTIONS.PointsLedger).find({ userId, kind: 'photo_import' });
  return all.filter((e) => e.delta < 0).length;
}

test('AR core：imageFileIds 逐张按序识别、结果拼接、整个任务只扣一次', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'ar-core-1', 100);
  const seen = [];
  const stub = {
    name: 'stub',
    async recognize(p) {
      seen.push(p);
      return [{ name: `条目${seen.length}`, amountFen: 10000, note: '', raw: `raw${seen.length}` }];
    },
  };
  const r = await importer.startImportTask(db, owner, owner, {
    kind: 'gift',
    imageFileIds: ['cloud://bkt/ocr-imports/1.jpg', 'cloud://bkt/ocr-imports/2.jpg'],
    ocrAdapter: stub,
  });
  assert.eq(
    seen.join(','),
    'cloud://bkt/ocr-imports/1.jpg,cloud://bkt/ocr-imports/2.jpg',
    '适配器应按序收到每个 fileID（不是本地路径）',
  );
  assert.eq(r.items.map((i) => i.name).join(','), '条目1,条目2', '结果按照片顺序拼接');
  assert.eq(r.adapter, 'stub', '任务应回标实际适配器名');
  assert.eq(await points.getBalance(db, owner), 95, '整个任务只扣 5 分一次');
  assert.eq(await spendCount(db, owner), 1, '流水只有一条 spend');
});

test('AR core：imageFileIds 任一张识别失败 → 整批抛错、不扣费', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'ar-core-2', 100);
  const stub = {
    name: 'stub',
    async recognize(p) {
      if (p.endsWith('2.jpg')) throw new Error('这张照片没认出来');
      return [{ name: '甲', amountFen: 10000, note: '', raw: '' }];
    },
  };
  let caught = null;
  try {
    await importer.startImportTask(db, owner, owner, {
      kind: 'gift',
      imageFileIds: ['cloud://bkt/ocr-imports/1.jpg', 'cloud://bkt/ocr-imports/2.jpg'],
      ocrAdapter: stub,
    });
  } catch (e) { caught = e; }
  assert(caught && /没认出来/.test(caught.message), '第二张失败应整批抛错');
  assert.eq(await points.getBalance(db, owner), 100, '识别未全成功不扣费');
  assert.eq(await spendCount(db, owner), 0, '不应有 spend 流水');
});

/* ---------- ⑥ 清理钩子 ---------- */

test('AR 清理：cleanupImportPhotos 仅云模式且有 fileID 时删除，删除失败静默', async () => {
  try {
    dataService._resetForTest();
    dataService._setModeForTest('cloud');
    const deleted = [];
    dataService._setDeleterForTest(async (list) => { deleted.push(list.slice()); });
    await dataService.cleanupImportPhotos(['cloud://fake-env.fake-bucket/ocr-imports/x.jpg']);
    assert.eq(deleted.length, 1, '云模式有 fileID 应删一次');
    assert.eq(deleted[0].join(','), 'cloud://fake-env.fake-bucket/ocr-imports/x.jpg', '删的应是这批 fileID');
    await dataService.cleanupImportPhotos([]);
    await dataService.cleanupImportPhotos(['/tmp/local.jpg']);
    assert.eq(deleted.length, 1, '空列表/非云路径不删');
    dataService._setModeForTest('local');
    await dataService.cleanupImportPhotos(['cloud://fake-env.fake-bucket/ocr-imports/x.jpg']);
    assert.eq(deleted.length, 1, '本地模式不删');
    dataService._setModeForTest('cloud');
    dataService._setDeleterForTest(async () => { throw new Error('deleteFile:fail'); });
    await dataService.cleanupImportPhotos(['cloud://fake-env.fake-bucket/ocr-imports/y.jpg']); // 不应抛
    assert(true, '删除失败应静默（不影响导入结果）');
  } finally { dataService._resetForTest(); }
});
