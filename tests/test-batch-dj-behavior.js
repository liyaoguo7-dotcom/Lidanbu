/** DJ批（用户 2026-10-30 定）：
 * 老板后台每档会员价加安卓价＋苹果价两框（留空=跟现价），落库到档位的
 * androidPriceFen／iosPriceFen；购买仍走现价 priceFen（换真适配器时再按渠道选价）；
 * 积分包不分价（未定）。 */
const { test, assert } = require('./fw');
const { newDB } = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const admin = core.admin;
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

const BOSS = 'boss_openid_1';

async function seedAdmin(db) {
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
}

test('DJ 分平台价：落库＋回读＋非法值拒', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const plans = [{ id: 'year', name: '年卡', priceFen: 7000, days: 365, androidPriceFen: 7000, iosPriceFen: 7875 }];
  const r = await admin.updatePricing(db, BOSS, plans);
  assert.eq(r.pricing[0].androidPriceFen, 7000, '安卓价落库');
  assert.eq(r.pricing[0].iosPriceFen, 7875, '苹果价落库');
  assert.eq(r.pricing[0].priceFen, 7000, '现价不动（购买仍走现价）');
  const doc = await db.collection(COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
  assert.eq(doc.pricing[0].iosPriceFen, 7875, '苹果价已写库');
  for (const bad of [{ androidPriceFen: -1 }, { iosPriceFen: 1.5 }, { androidPriceFen: 100000001 }]) {
    let err = null;
    try { await admin.updatePricing(db, BOSS, [{ id: 'year', name: '年卡', priceFen: 7000, days: 365, ...bad }]); } catch (e) { err = e; }
    assert(err && err.code === 'bad-config', `非法分平台价拒：${JSON.stringify(bad)}`);
  }
  const r2 = await admin.updatePricing(db, BOSS, [{ id: 'year', name: '年卡', priceFen: 7000, days: 365 }]);
  assert(r2.pricing[0].androidPriceFen === undefined && r2.pricing[0].iosPriceFen === undefined, '不给分平台价则不落库（老档位不受影响）');
});

test('DJ 老板后台定价页：每档有安卓价＋苹果价两框', () => {
  const wxml = readMp('pages/admin/app-config/app-config.wxml');
  const js = readMp('pages/admin/app-config/app-config.js');
  assert(wxml.includes('安卓价（元）') && wxml.includes('data-field="androidYuan"'), '每档有安卓价框');
  assert(wxml.includes('苹果价（元）') && wxml.includes('data-field="iosYuan"'), '每档有苹果价框');
  assert(js.includes('androidYuan: formatAmount') && js.includes('iosYuan: formatAmount'), '旧档位无分平台价时回落现价展示');
  assert(js.includes('androidPriceFen') && js.includes('iosPriceFen'), '保存带分平台价');
  assert((wxml.match(/data-field="androidYuan"/g) || []).length === 1, '安卓价框只在档位区（积分包无分价）');
  assert((wxml.match(/data-field="iosYuan"/g) || []).length === 1, '苹果价框只在档位区（积分包无分价）');
});
