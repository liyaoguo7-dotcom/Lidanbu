/**
 * 拍照页计费动态联动（2026-10-30 用户定：不写死、跟老板后台走）：
 * ① 静态兜底默认与已定价一致（2026-10-28 改定 2 分，原 5 分）；
 * ② 攒照片页首屏单价与计费说明仍走动态 photoCost；
 * ③ 老板后台说明文字不再写死旧价；
 * ④ 老板后台 DB 有值时仍以 DB 为准（动态联动本身不被默认值覆盖）。
 */
const { test, assert } = require('./fw');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');
const AppConfig = require('../miniprogram/config/app-config');
const core = require('../core/points');

test('拍照单价静态默认与已定价一致（2 分，非旧 5 分）', () => {
  assert.eq(AppConfig.points.photoImportCost, 2, '静态配置默认应为 2 分');
});

test('无 DB 时生效单价兜底为 2 分（不白屏、不报错）', async () => {
  const s = await core.resolvePointsSettings(null);
  assert.eq(s.photoImportCost, 2, '无 DB 兜底应为 2 分');
});

test('攒照片页首屏单价为 2 分、计费说明仍走动态 photoCost', () => {
  const js = rd('miniprogram/pages/import/import-photos.js');
  assert(js.includes('photoCost: 2'), '首屏 photoCost 应为 2');
  const wxml = rd('miniprogram/pages/import/import-photos.wxml');
  assert(wxml.includes('{{photoCost}}'), '计费说明应走动态 photoCost');
});

test('老板后台说明文字不再写死旧价 5 分', () => {
  const wxml = rd('miniprogram/pages/admin/app-config/app-config.wxml');
  assert(!wxml.includes('扣 5 分'), '管理后台说明不应再写死 5 分');
});

test('老板后台 DB 有值时仍以 DB 为准（动态联动不被默认值覆盖）', async () => {
  const stubDb = { collection: () => ({ findOne: async () => ({ points: { photoImportCost: 7 } }) }) };
  const s = await core.resolvePointsSettings(stubDb);
  assert.eq(s.photoImportCost, 7, 'DB 覆盖值应胜出');
});
