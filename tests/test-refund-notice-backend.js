/** 退款文案放后端（2026-10-31 用户定）：
 * - 云端 appConfig 文档 payment.refundNotice 优先，未配置/空白时返回 null，
 *   购买页回退前端静态短句，永不空白
 * - 老板后台 app-config 新增“退款文案”节＋菜单入口，可改可清空恢复默认，
 *   保存走 admin.updateRefundNotice（仅管理员、审计记账、最长 500 字）
 * - 购买页数据聚合读服务端文案（remote-core payment/admin 清单同步登记） */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const { newDB } = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const AppConfig = core.config;

const BOSS = 'boss_refund_admin';
const NOBODY = 'random_refund_user';
const SHORT = '本产品为虚拟产品，一经购买不能退款，购买前请确定。';
const CUSTOM = '退款请联系客服，7 天内可申请。';

async function seedAdmin(db) {
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
}

test('退款文案后端：未配置时 getRefundNotice 返回 null，购买页回退静态短句', async () => {
  const db = await newDB();
  assert.eq(await core.payment.getRefundNotice(db, 'anyone'), null, '云端未配置时应返回 null，由调用方回退静态短句');
  assert.eq(AppConfig.payment.refundNotice, SHORT, '静态兜底应为短句');
});

test('退款文案后端：云端配置优先，空白视为未配置', async () => {
  const db = await newDB();
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', payment: { refundNotice: CUSTOM } });
  assert.eq(await core.payment.getRefundNotice(db, 'anyone'), CUSTOM, '云端已配置时应优先云端文案');
  const db2 = await newDB();
  await db2.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', payment: { refundNotice: '   ' } });
  assert.eq(await core.payment.getRefundNotice(db2, 'anyone'), null, '云端空白应视为未配置、回退静态短句');
});

test('退款文案后端：仅管理员可改，保存后 getConfig 生效，清空恢复默认', async () => {
  const db = await newDB();
  await seedAdmin(db);
  let err = null;
  try { await core.admin.updateRefundNotice(db, NOBODY, CUSTOM); } catch (e) { err = e; }
  assert(err && err.code === 'not-admin', '非管理员改退款文案应被拒');
  const r = await core.admin.updateRefundNotice(db, BOSS, CUSTOM);
  assert.eq(r.refundNotice, CUSTOM, '保存后应返回新文案');
  const cfg = await core.admin.getConfig(db, BOSS);
  assert.eq(cfg.refundNotice, CUSTOM, 'getConfig 应返回云端新文案');
  assert.eq(await core.payment.getRefundNotice(db, BOSS), CUSTOM, '购买页读服务端应拿到新文案');
  await core.admin.updateRefundNotice(db, BOSS, '');
  const cfg2 = await core.admin.getConfig(db, BOSS);
  assert.eq(cfg2.refundNotice, SHORT, '清空后 getConfig 应恢复默认短句');
  let longErr = null;
  try { await core.admin.updateRefundNotice(db, BOSS, 'x'.repeat(501)); } catch (e) { longErr = e; }
  assert(longErr, '超 500 字应被拒');
});

test('退款文案后端：远程清单与老板后台入口同步登记', async () => {
  const ROOT = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const remote = read('miniprogram/services/remote-core.js');
  assert(remote.includes('getRefundNotice'), 'remote-core payment 清单应登记 getRefundNotice');
  assert(remote.includes('updateRefundNotice'), 'remote-core admin 清单应登记 updateRefundNotice');
  const ds = read('miniprogram/services/data-service.js');
  assert(ds.includes('getRefundNotice'), '购买页数据聚合应读服务端退款文案');
  assert(ds.includes('adminUpdateRefundNotice'), 'data-service 应有老板后台改文案接口');
  const appCfg = read('miniprogram/pages/admin/app-config/app-config.js');
  assert(appCfg.includes("refund: { title: '退款文案' }"), '配置页应有退款文案节');
  assert(appCfg.includes('onSaveRefund'), '配置页应有保存退款文案入口');
  const appWxml = read('miniprogram/pages/admin/app-config/app-config.wxml');
  assert(appWxml.includes("section === 'refund'"), '配置页模板应有退款文案节');
  const home = read('miniprogram/pages/admin/admin-home/admin-home.js');
  assert(home.includes("title: '退款文案'"), '老板平台菜单应有退款文案入口');
  assert(home.includes("section: 'refund'"), '退款文案菜单应指向 refund 节');
});
