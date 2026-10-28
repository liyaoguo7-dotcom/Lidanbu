/**
 * BT批补充字库 12 片（2026-10-28，用户真机：切枝芒后总/虎仍宋体）：
 * 旧 6 片 base64 后 742–953KB，全部高于已证实走通的莫大（634KB），
 * 且旧片 name 表为空；BT批等分 12 片（base64 约 354–504KB）并写回族名。
 * 本文件只断言代码层不变量；12 片 TTF 文件本身的校验（cmap＝字表、
 * 名字表非空、体积）在构建脚本 build-supp12.py 里做。
 */
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const { SUPP_BOUNDS, GB2312_ALL } = require('../miniprogram/pages/landscape/font-charset.js');
const { createFontManager } = require('../miniprogram/services/font-manager.js');

test('BT-12片：SUPP_FONTS 与 SUPP_BOUNDS 各 12 项、族名/文件名一一对应', () => {
  assert.eq(LC.SUPP_FONTS.length, 12, '补充 12 片');
  assert.eq(SUPP_BOUNDS.length, 12, '分界 12 字');
  const cps = [...SUPP_BOUNDS].map((c) => c.codePointAt(0));
  for (let i = 1; i < cps.length; i++) assert(cps[i] > cps[i - 1], '分界按码位升序');
  LC.SUPP_FONTS.forEach((f, i) => {
    const n = i + 1;
    assert.eq(f.id, `supp${n}`, `第 ${n} 片 id`);
    assert.eq(f.family, `ZhiMangSupp${n}`, `第 ${n} 片族名`);
    assert.eq(f.file, `zhimang-supp${n}.ttf`, `第 ${n} 片文件名`);
    assert.eq(f.cloudFile, f.file, `第 ${n} 片云端文件名与本地一致`);
  });
  assert.eq(GB2312_ALL.length, 6763, 'GB2312 字表 6763 字未变');
});

test('BT-定位：总/虎/晓落到新片号', () => {
  assert.eq(LC.suppChunkIndexOf('总'), 3, '总（U+603B）→ supp4');
  assert.eq(LC.suppChunkIndexOf('晓'), 4, '晓（U+6653）→ supp5');
  assert.eq(LC.suppChunkIndexOf('虎'), 8, '虎（U+864E）→ supp9');
  assert.eq(LC.suppChunksForText('总虎晓').join(','), '3,4,8', '多字去重升序');
});

test('BT-回退链含全部 12 片补充族', () => {
  const stack = LC.selectedStack('bakudai');
  for (let i = 1; i <= 12; i++) assert(stack.includes(`"ZhiMangSupp${i}"`), `栈含 ZhiMangSupp${i}`);
});

test('BT-按需加载：ensureSupplements 把片下标映到正确族名', async () => {
  const loaded = [];
  const wxApi = {
    loadFontFace: (o) => { loaded.push(o.family); o.success(); },
    loadSubpackage: (o) => o.success(),
  };
  const fm = createFontManager({ wxApi, storage: { get: () => '', set: () => {} }, cloudBase: 'https://cdn.example.com/fonts/' });
  assert.eq(await fm.ensureSupplements([3, 4, 8]), true, '三片都应加载成功');
  assert.eq(loaded.join(','), 'ZhiMangSupp4,ZhiMangSupp5,ZhiMangSupp9', '下标→族名映射');
});
