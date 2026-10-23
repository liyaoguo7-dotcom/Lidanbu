/** 云函数 exportXlsx 路由分发测试（mock 上下文 + MemoryDB + 真 xlsx 生成） */
const { test, assert } = require('./fw');
const core = require('../core');
const { buildXlsx } = require('../core/export-xlsx');
const { createExportXlsxHandler } = require('../cloudfunctions/api/routes-export');
const { newDB, setupOwner, setupMember } = require('./helpers');
const { COLLECTIONS } = core.models;

test('云函数导出路由：主人导出成功，上传云存储返回 fileId 并写 ExportJob（任务AE 正式形态）', async () => {
  const db = await newDB();
  const { owner } = await setupOwner(db);
  const uploaded = new Map();
  const uploadFile = async (cloudPath, buf) => {
    uploaded.set(cloudPath, Buffer.from(buf));
    return `cloud://fake/${cloudPath}`;
  };
  const handle = createExportXlsxHandler({ db, buildXlsx, uploadFile });
  const res = await handle({ action: 'exportXlsx' }, { openid: owner });
  assert(res.ok === true, '应成功:' + JSON.stringify(res));
  assert.eq(res.data.fileName, '礼单簿导出.xlsx', '文件名');
  assert(typeof res.data.fileId === 'string' && res.data.fileId.startsWith('cloud://fake/exports/'), '应返回云存储 fileId（页面凭它 downloadFile）');
  assert(res.data.fileId.includes(owner), '云路径按主人分目录');
  const buf = uploaded.get(res.data.fileId.replace('cloud://fake/', ''));
  assert(buf && buf.length > 0 && buf[0] === 0x50 && buf[1] === 0x4b, '上传内容是真 xlsx(zip)');
  const jobs = await db.collection(COLLECTIONS.ExportJob).find({ ownerId: owner });
  assert.eq(jobs.length, 1, '写了1条 ExportJob');
  assert.eq(jobs[0].status, 'done', '状态 done');
  assert(/\+送礼/.test(jobs[0].scope), '范围摘要含送礼');
});

test('云函数导出路由：未注入 uploadFile 时回落 base64（旧路兼容）', async () => {
  const db = await newDB();
  const { owner } = await setupOwner(db);
  const handle = createExportXlsxHandler({ db, buildXlsx });
  const res = await handle({ action: 'exportXlsx' }, { openid: owner });
  assert(res.ok === true, '应成功');
  const buf = Buffer.from(res.data.fileBase64, 'base64');
  assert(buf.length > 0 && buf[0] === 0x50 && buf[1] === 0x4b, '解码后是 xlsx(zip)');
});

test('云函数导出路由：成员有导出开关可导出已授权部分', async () => {
  const db = await newDB();
  const { owner, ev } = await setupOwner(db);
  const { member } = await setupMember(db, owner, {
    events: [ev], gifts: false, switches: { view: true, export: true },
  });
  const handle = createExportXlsxHandler({ db, buildXlsx });
  const res = await handle({ action: 'exportXlsx', ownerId: owner, includeGifts: false }, { openid: member });
  assert(res.ok === true, '成员应可导出:' + JSON.stringify(res));
  const jobs = await db.collection(COLLECTIONS.ExportJob).find({ ownerId: owner });
  assert.eq(jobs.length, 1, '成员导出也写 ExportJob');
});

test('云函数导出路由：成员无导出开关被拒，且不写 ExportJob（数据未变）', async () => {
  const db = await newDB();
  const { owner, ev } = await setupOwner(db);
  const { member } = await setupMember(db, owner, {
    events: [ev], gifts: false, switches: { view: true },
  });
  const handle = createExportXlsxHandler({ db, buildXlsx });
  const res = await handle({ action: 'exportXlsx', ownerId: owner }, { openid: member });
  assert(res.ok === false, '应被拒');
  assert(/无权限/.test(res.reason), '用户可读拒绝文案:' + res.reason);
  const jobs = await db.collection(COLLECTIONS.ExportJob).find({ ownerId: owner });
  assert.eq(jobs.length, 0, '拒绝后未写 ExportJob');
});

test('云函数导出路由：未知 action 与缺身份被拒', async () => {
  const db = await newDB();
  const handle = createExportXlsxHandler({ db, buildXlsx });
  const r1 = await handle({ action: 'nope' }, { openid: 'x' });
  assert(r1.ok === false && /未知action/.test(r1.reason), '未知 action 被拒');
  const r2 = await handle({ action: 'exportXlsx' }, {});
  assert(r2.ok === false && /身份/.test(r2.reason), '缺 openid 被拒');
});
