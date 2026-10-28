/**
 * BU批两套补全（2026-10-28，用户指定）：莫大毛笔／马善政／枝芒行书
 * 三款用枝芒补全，霞鹜文楷／龙藏体／古典宋体三款用霞鹜补全。
 * 两套同字表同切法，分界相同；同一时刻栈内只有一套补全。
 * 文件层校验（cmap＝字表、名字表、体积）在构建脚本 build-supp12-lxgw.py 里做。
 */
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const { createFontManager } = require('../miniprogram/services/font-manager.js');

test('BU-指定映射：六款字体各归其集', () => {
  assert.eq(LC.SUPP_FONTS.length, 12, '枝芒集 12 片');
  assert.eq(LC.SUPP_LXGW_FONTS.length, 12, '霞鹜集 12 片');
  const zm = (id) => LC.suppFontsFor(id);
  assert.eq(zm('bakudai'), LC.SUPP_FONTS, '莫大→枝芒集');
  assert.eq(zm('mashanzheng'), LC.SUPP_FONTS, '马善政→枝芒集');
  assert.eq(zm('zhimang'), LC.SUPP_FONTS, '枝芒自己→枝芒集');
  assert.eq(zm('lxgw'), LC.SUPP_LXGW_FONTS, '霞鹜→霞鹜集');
  assert.eq(zm('longcang'), LC.SUPP_LXGW_FONTS, '龙藏→霞鹜集');
  assert.eq(zm('cactus'), LC.SUPP_LXGW_FONTS, '古典→霞鹜集');
  assert.eq(zm('unknown'), LC.SUPP_FONTS, '未知字体默认枝芒集');
  LC.SUPP_LXGW_FONTS.forEach((f, i) => {
    const n = i + 1;
    assert.eq(f.id, `lxsupp${n}`, `霞鹜第 ${n} 片 id`);
    assert.eq(f.family, `LxgwSupp${n}`, `霞鹜第 ${n} 片族名`);
    assert.eq(f.file, `lxgw-supp${n}.ttf`, `霞鹜第 ${n} 片文件名`);
  });
});

test('BU-栈内只有一套补全、两套不混用', () => {
  for (const id of ['bakudai', 'mashanzheng', 'zhimang']) {
    const s = LC.selectedStack(id);
    assert(s.includes('"ZhiMangSupp1"') && !s.includes('"LxgwSupp1"'), `${id} 栈只含枝芒集`);
  }
  for (const id of ['lxgw', 'longcang', 'cactus']) {
    const s = LC.selectedStack(id);
    assert(s.includes('"LxgwSupp1"') && !s.includes('"ZhiMangSupp1"'), `${id} 栈只含霞鹜集`);
  }
});

test('BU-按需加载：同一下标按字体映到不同集', async () => {
  const loaded = [];
  const wxApi = {
    loadFontFace: (o) => { loaded.push(o.family); o.success(); },
    loadSubpackage: (o) => o.success(),
  };
  const fm = createFontManager({ wxApi, storage: { get: () => '', set: () => {} }, cloudBase: 'https://cdn.example.com/fonts/' });
  assert.eq(await fm.ensureSupplements([3, 4, 8], 'lxgw'), true, '霞鹜三片应加载成功');
  assert.eq(loaded.join(','), 'LxgwSupp4,LxgwSupp5,LxgwSupp9', '霞鹜下标→霞鹜族名');
  loaded.length = 0;
  assert.eq(await fm.ensureSupplements([3, 4, 8], 'bakudai'), true, '莫大三片应加载成功');
  assert.eq(loaded.join(','), 'ZhiMangSupp4,ZhiMangSupp5,ZhiMangSupp9', '莫大下标→枝芒族名');
});

test('BU-白名单含霞鹜 12 片', () => {
  const fs = require('fs');
  const api = fs.readFileSync('cloudfunctions/api/index.js', 'utf8');
  for (let i = 1; i <= 12; i++) assert(api.includes(`'lxgw-supp${i}.ttf'`), `白名单含 lxgw-supp${i}.ttf`);
});
