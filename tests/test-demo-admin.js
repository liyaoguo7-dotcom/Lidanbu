/** 演示模式自动成为老板平台管理员（任务W）：
 * - 本地演示模式（localMode）init 时自动把演示用户加进 appConfig 的
 *   adminIds 名单，开发者工具里能直接测老板平台补全页；
 * - 重复初始化去重，且不抹掉文档里已有的其他配置段（pricing 等）；
 * - 非 localMode（正式路径）绝不写名单，core/admin 的 fail closed 不变。 */
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const { test, assert } = require('./fw');
const core = require('../core');
const { COLLECTIONS } = core.models;
const AppConfig = require('../miniprogram/config/app-config');
const dataService = require('../miniprogram/services/data-service');

/** 用内存对象冒充 wx storage（可跨"重启"复用同一份 store，模拟开发者工具持久化） */
function installWx(store) {
  const prev = global.wx;
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
  };
  return () => { global.wx = prev; };
}

test('演示管理员：localMode 初始化后演示用户自动进名单，isAdmin 为真且 searchAccounts 可调', async () => {
  const restore = installWx({});
  // 任务AD 后出厂默认 localMode=false：演示行为测试须显式钉住 localMode=true（测后恢复）
  const prev = AppConfig.demo.localMode;
  AppConfig.demo.localMode = true;
  try {
    dataService._resetForTest();
    const db = new core.db.MemoryDB();
    dataService._setDbFactoryForTest(() => db);
    const r = await dataService.init();
    assert(r.ok === true, 'init 应成功');
    const uid = dataService.userId;
    assert(uid && uid.startsWith('demo_'), `演示 userId 已生成（实际 ${uid}）`);
    assert((await core.admin.isAdmin(db, uid)) === true, 'core.admin.isAdmin(演示用户) 应为真');
    const res = await dataService.adminSearchAccounts({});
    assert(res && Array.isArray(res.items) && res.total >= 1,
      `补全接口 searchAccounts 应可成功调用（实际 ${JSON.stringify(res && { total: res.total })}）`);
  } finally { AppConfig.demo.localMode = prev; restore(); dataService._resetForTest(); }
});

test('演示管理员：重复初始化不重复加名单，已有配置段（pricing）不被抹掉', async () => {
  const restore = installWx({});
  const prev = AppConfig.demo.localMode;
  AppConfig.demo.localMode = true;
  const db = new core.db.MemoryDB();
  try {
    dataService._resetForTest();
    dataService._setDbFactoryForTest(() => db);
    await dataService.init();
    const uid = dataService.userId;
    // 模拟老板平台已在同一 singleton 文档里写过价格配置
    const col = db.collection(COLLECTIONS.AppConfig);
    await col.update({ _id: 'singleton' }, { pricing: [{ id: 'year', name: '年卡', priceFen: 7000 }] });
    // 模拟开发者工具重启：清服务状态，storage 里保留同一 userId
    dataService._resetForTest();
    dataService._setDbFactoryForTest(() => db);
    const r = await dataService.init();
    assert(r.ok === true, '二次 init 应成功');
    assert.eq(dataService.userId, uid, '二次 init 应复用同一演示用户');
    const doc = await col.findOne({ _id: 'singleton' });
    const hits = (doc.adminIds || []).filter((x) => x === uid).length;
    assert.eq(hits, 1, 'adminIds 中演示用户只出现一次（去重）');
    assert(doc.pricing && doc.pricing[0] && doc.pricing[0].priceFen === 7000,
      '已有的 pricing 配置段不得被抹掉');
  } finally { AppConfig.demo.localMode = prev; restore(); dataService._resetForTest(); }
});

test('演示管理员：非 localMode（正式路径）初始化不写 adminIds，isAdmin 仍为假', async () => {
  const restore = installWx({});
  const prev = AppConfig.demo.localMode;
  try {
    AppConfig.demo.localMode = false;
    const db = new core.db.MemoryDB();
    dataService._resetForTest();
    dataService._setDbFactoryForTest(() => db);
    const r = await dataService.init();
    assert(r.ok === true, '非演示模式 init 仍可成功');
    const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
    const ids = doc && Array.isArray(doc.adminIds) ? doc.adminIds : [];
    assert(!ids.includes(dataService.userId), '正式路径不得把用户写进管理员名单');
    assert((await core.admin.isAdmin(db, dataService.userId)) === false,
      '正式路径下该用户不是管理员（fail closed 不变）');
  } finally {
    AppConfig.demo.localMode = prev;
    restore();
    dataService._resetForTest();
  }
});
