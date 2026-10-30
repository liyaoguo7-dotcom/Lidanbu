/**
 * DQ批：白屏修复＋管理员免会员（2026-10-30）。
 * ① 白屏：前端 core 在无 Node 内置模块环境下能加载（微信 require 模拟：
 *    裸模块一律抛错，只放行相对路径；另断言 pay-adapter 源码顶层无 Node
 *    内置模块 require，签名用的 crypto/https 只在函数内懒加载）。
 * ② 免会员：管理员拍照导入跳过会员门禁与积分（0 余额也能识别、cost 0、
 *    不扣费）；额度按五年卡；家庭共享邀请放行；横置门禁放行。
 * ③ 普通用户口径不动：非会员拍照仍拦、额度仍按免费算、邀请仍拦。
 * 全部打桩，绝不真连网。
 */
const path = require('path');
const vm = require('vm');
const fs = require('fs');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

const FRONT_CORE = path.join(__dirname, '..', 'miniprogram', 'core');
const APP_CONFIG = require('../miniprogram/config/app-config');

/* ---------- 微信 require 模拟：只放行相对路径，裸模块（Node 内置）一律抛错 ---------- */

function loadWechatModule(entryFile) {
  const cache = new Map();
  function loadFile(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const code = fs.readFileSync(file, 'utf8');
    const mod = { exports: {} };
    cache.set(file, mod);
    const fn = vm.runInNewContext(
      `(function(module, exports, require, __filename, __dirname) {\n${code}\n})`,
      { console, wx: {} },
    );
    const localRequire = (req) => {
      if (req.startsWith('.')) {
        let resolved = path.resolve(path.dirname(file), req);
        if (!fs.existsSync(resolved)) resolved += '.js';
        return loadFile(resolved);
      }
      throw new Error(`微信环境无此模块: ${req}`);
    };
    fn(mod, mod.exports, localRequire, file, path.dirname(file));
    return mod.exports;
  }
  return loadFile(entryFile);
}

async function seedAdminDoc(db, adminIds) {
  await db.collection(COLLECTIONS.AppConfig).insert({
    _id: 'singleton',
    adminIds,
    features: { photoImport: true, familyShare: true, landscape: true },
  });
}

test('DQ 白屏：前端 core/index 在微信 require 模拟下能加载（无 Node 内置模块）', async () => {
  const frontCore = loadWechatModule(path.join(FRONT_CORE, 'index.js'));
  assert(frontCore.payAdapter, 'core/index 应导出 payAdapter');
  assert.eq(
    frontCore.payAdapter.platformPriceFen({ priceFen: 1000, iosPriceFen: 1200 }, 'ios'),
    1200,
    '前端分平台取价（iOS）应正常',
  );
  assert.eq(
    frontCore.payAdapter.platformPriceFen({ priceFen: 1000, androidPriceFen: 1000 }, 'android'),
    1000,
    '前端分平台取价（安卓）应正常',
  );
  const mock = new frontCore.payAdapter.MockPayAdapter({ result: 'success' });
  const r = await mock.createOrder({ outTradeNo: 't1' });
  assert.eq(r.channelTradeNo, 'mock_t1', '前端 Mock 适配器应正常建单');
});

test('DQ 白屏：前端 pay-adapter 源码顶层无 Node 内置模块 require（签名仍懒加载）', async () => {
  const src = fs.readFileSync(path.join(FRONT_CORE, 'pay-adapter.js'), 'utf8');
  // 本文件无缩进风格，不能靠缩进区分顶层与函数内：按函数体切分，取
  // hmacSha256Hex / defaultHttpGetJson 两段体，其余部分（顶层）不应出现
  // Node 内置模块 require；注释先剥掉（顶部注释会提及模块名）。
  function bodyOf(name) {
    const start = src.indexOf(`function ${name}`);
    assert(start >= 0, `应有 ${name} 函数`);
    const end = src.indexOf('\n}', start);
    assert(end > start, `${name} 应有函数体结束`);
    return src.slice(start, end);
  }
  const lazyBodies = bodyOf('hmacSha256Hex') + '\n' + bodyOf('defaultHttpGetJson');
  assert(lazyBodies.includes("require('crypto')"), 'crypto 应在 hmacSha256Hex 内懒加载（服务端签名不能删）');
  assert(lazyBodies.includes("require('https')"), 'https 应在 defaultHttpGetJson 内懒加载（服务端 code2Session 不能删）');
  const rest = src
    .replace(bodyOf('hmacSha256Hex'), '')
    .replace(bodyOf('defaultHttpGetJson'), '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\/\/.*$/gm, '');
  const nodeRequire = /require\('(?:crypto|https?|fs|net|os|path|child_process|dgram|tls)'\)/;
  assert(!nodeRequire.test(rest), '顶层（函数体外）不应再有 Node 内置模块 require（否则前端加载即白屏）');
});

test('DQ 免会员：管理员拍照导入跳过会员门禁与积分（0 余额、cost 0、不扣费）', async () => {
  const db = await h.newDB();
  await seedAdminDoc(db, ['admin1']);
  await h.newUser(db, 'admin1'); // 免费用户（无会员）
  assert.eq(await core.points.getBalance(db, 'admin1'), 0, '管理员初始 0 积分');
  const r = await core.importer.startImportTask(db, 'admin1', 'admin1', {
    jobId: 'job-admin', kind: 'gift', imagePath: 'wxfile://ok.jpg',
  });
  assert.eq(r.items.length, 3, '管理员应识别出 3 条（不被会员门禁拦）');
  assert.eq(r.cost, 0, '管理员 cost 回 0（不扣费）');
  assert.eq(await core.points.getBalance(db, 'admin1'), 0, '管理员余额仍 0（未扣费）');
  const spends = await db.collection(COLLECTIONS.PointsLedger).find({ userId: 'admin1', kind: 'photo_import' });
  assert.eq(spends.filter((e) => e.delta < 0).length, 0, '管理员无 photo_import 扣费流水');
});

test('DQ 免会员：普通用户拍照口径不动（非会员仍拦；会员仍按 2 分扣）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'free1'); // 免费用户，非管理员
  let err = null;
  try {
    await core.importer.startImportTask(db, 'free1', 'free1', {
      jobId: 'job-free', kind: 'gift', imagePath: 'wxfile://ok.jpg',
    });
  } catch (e) { err = e; }
  assert(err && err.code === 'member-required', '普通非会员拍照仍应报 member-required');
});

test('DQ 免会员：管理员额度按五年卡（免费额度外仍放行；普通用户仍拦）', async () => {
  const db = await h.newDB();
  await seedAdminDoc(db, ['admin1']);
  await h.newUser(db, 'admin1');
  await h.newUser(db, 'free1');
  // 各建 3 个礼薄（免费上限 3 个），再申请第 4 个
  for (const uid of ['admin1', 'free1']) {
    for (let i = 0; i < 3; i++) {
      await db.collection(COLLECTIONS.ReceiveEvent).insert({ ownerId: uid, name: `薄${i}` });
    }
  }
  const adminUser = await db.collection(COLLECTIONS.User).findOne({ _id: 'admin1' });
  const freeUser = await db.collection(COLLECTIONS.User).findOne({ _id: 'free1' });
  const adminQ = await core.quota.checkAddQuota(db, adminUser, 'event');
  const freeQ = await core.quota.checkAddQuota(db, freeUser, 'event');
  assert.eq(adminQ.ok, true, '管理员第 4 个礼薄应放行（五年卡 50 个）');
  assert.eq(freeQ.ok, false, '普通免费用户第 4 个礼薄仍应拦');
  const q = core.quota.getEffectiveQuota(adminUser, APP_CONFIG, Date.now(), { isAdmin: true });
  assert.eq(q.receiveEvents, 50, '管理员额度礼薄数 = 五年卡 50');
  assert.eq(q.recordsPerEvent, 1000, '管理员额度每薄条数 = 五年卡 1000');
  assert.eq(q.giftRecords, 1000, '管理员额度送礼条数 = 五年卡 1000');
  assert.eq(q.contacts, 1000, '管理员额度联系人数 = 五年卡 1000');
});

test('DQ 免会员：管理员家庭共享邀请放行，普通非会员仍拦', async () => {
  const db = await h.newDB();
  await seedAdminDoc(db, ['admin1']);
  await h.newUser(db, 'admin1');
  await h.newUser(db, 'free1');
  const r = await core.share.invite(db, 'admin1', { switches: {}, scope: { events: [], gifts: true } });
  assert(r.membershipId, '管理员非会员应能发出家庭共享邀请');
  let err = null;
  try {
    await core.share.invite(db, 'free1', { switches: {}, scope: { events: [], gifts: true } });
  } catch (e) { err = e; }
  assert(err && err.code === 'member-required', '普通非会员邀请仍应报 member-required');
});

test('DQ 免会员：横置门禁管理员放行，普通非会员仍拦', async () => {
  // eslint-disable-next-line import/no-dynamic-require
  const route = require('../miniprogram/services/landscape-route.js');
  const flags = { landscape: true, memberOnly: ['landscapeMode'] };
  assert.eq(
    route.resolveLandscapeGate({ membership: { state: 'free' }, flags, isAdmin: true }),
    'ok',
    '管理员非会员横置应放行',
  );
  assert.eq(
    route.resolveLandscapeGate({ membership: { state: 'free' }, flags }),
    'member-only',
    '普通非会员横置仍应拦',
  );
  assert.eq(
    route.resolveBookRoute({ landscapeOn: true, membership: { state: 'free' }, flags, isAdmin: true }),
    'landscape',
    '管理员礼薄入口路由应走横置',
  );
});
