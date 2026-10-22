/**
 * 字体来源适配层测试（任务E：字体包进分包 + font-source 适配层）
 * 覆盖：来源优先级顺序（缓存→分包→云）、云地址为空跳过云来源、
 * 分包路径正确性、云两种形态（https 直链 / cloud:// 下载）、
 * ensureSubpackage 容错、font-manager 按序逐个尝试与首成即止。
 */
const { test, assert } = require('./fw');
const { createFontSource, SUBPACKAGE_ROOT, CACHE_FILE_KEY_PREFIX } = require('../miniprogram/services/font-source.js');
const { createFontManager } = require('../miniprogram/services/font-manager.js');
const { fontById } = require('../miniprogram/pages/landscape/landscape-core.js');

function memStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : ''), set: (k, v) => m.set(k, v), _map: m };
}
const LXGW = fontById('lxgw');

test('字体来源-分包路径正确性：路径与 app.json 分包结构一致', () => {
  const src = createFontSource({ storage: memStorage(), fileExists: () => false });
  assert.eq(src.subpackagePath(LXGW), '/packages/fonts/lxgw-wenkai.woff2', '分包内路径');
  assert.eq(SUBPACKAGE_ROOT, '/packages/fonts/', '分包根前缀');
  assert.eq(src.subpackageSource(LXGW), 'url("/packages/fonts/lxgw-wenkai.woff2")', 'loadFontFace 来源串');
  assert.eq(src.SUBPACKAGE_NAME, 'fonts', '分包名与 app.json 一致');
});

test('字体来源-默认优先级：无缓存无云时只有分包一个候选', () => {
  const src = createFontSource({ storage: memStorage(), fileExists: () => false });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list.length, 1, '候选数');
  assert.eq(list[0].kind, 'subpackage', '唯一候选是分包');
  assert.eq(list[0].needsSubpackage, true, '分包候选需先触发分包下载');
});

test('字体来源-云地址为空跳过云来源', () => {
  const src = createFontSource({ storage: memStorage(), fileExists: () => false, cloudBase: '' });
  assert.eq(src.isCloudEnabled(), false, '云未启用');
  assert(src.resolveCandidates(LXGW).every((c) => c.kind.indexOf('cloud') !== 0), '候选里没有云来源');
});

test('字体来源-缓存优先：缓存文件排在分包之前', () => {
  const st = memStorage();
  st.set(CACHE_FILE_KEY_PREFIX + 'lxgw', '/userData/landscape-fonts/lxgw-wenkai.woff2');
  const src = createFontSource({ storage: st, fileExists: (p) => p.indexOf('/userData/') === 0 });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list.length, 2, '缓存+分包两个候选');
  assert.eq(list[0].kind, 'cache', '缓存排第一');
  assert.eq(list[0].source, 'url("/userData/landscape-fonts/lxgw-wenkai.woff2")', '缓存来源串');
  assert.eq(list[1].kind, 'subpackage', '分包排第二');
  // 缓存记录在但文件已被系统清掉 → 不产生缓存候选
  const src2 = createFontSource({ storage: st, fileExists: () => false });
  assert.eq(src2.resolveCandidates(LXGW)[0].kind, 'subpackage', '缓存文件不存在时直接从分包起');
});

test('字体来源-https 云地址：云候选排在分包之后', () => {
  const src = createFontSource({ storage: memStorage(), fileExists: () => false, cloudBase: 'https://cdn.example.com/fonts' });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list.length, 2, '分包+云两个候选');
  assert.eq(list[1].kind, 'cloud-url', '云直链候选');
  assert.eq(list[1].source, 'url("https://cdn.example.com/fonts/lxgw-wenkai.woff2")', '云直链来源串（末尾斜杠自动补）');
});

test('字体来源-cloud:// 云存储：候选为 cloud-file 带 fileID', () => {
  const src = createFontSource({ storage: memStorage(), fileExists: () => false, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list[1].kind, 'cloud-file', '云文件候选');
  assert.eq(list[1].fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.woff2', 'fileID 拼装');
});

test('字体来源-ensureSubpackage：成功回 true、无 API 安全回 false', async () => {
  const okSrc = createFontSource({ storage: memStorage(), wxApi: { loadSubpackage: (o) => o.success() } });
  assert.eq(await okSrc.ensureSubpackage(), true, '分包下载成功');
  const noApiSrc = createFontSource({ storage: memStorage(), wxApi: {} });
  assert.eq(await noApiSrc.ensureSubpackage(), false, '无 loadSubpackage 时返回 false 不抛错');
  const failSrc = createFontSource({ storage: memStorage(), wxApi: { loadSubpackage: (o) => o.fail(new Error('net')) } });
  assert.eq(await failSrc.ensureSubpackage(), false, '分包下载失败返回 false 不抛错');
});

test('字体来源-manager 按优先级逐个尝试：缓存失败才试分包，首成即止', async () => {
  const st = memStorage();
  st.set(CACHE_FILE_KEY_PREFIX + 'lxgw', '/userData/landscape-fonts/lxgw-wenkai.woff2');
  const tried = [];
  const wxApi = {
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => {
      tried.push(o.source);
      if (o.source.indexOf('/packages/fonts/') >= 0) o.success();
      else o.fail(new Error('stale cache'));
    },
  };
  const fm = createFontManager({ wxApi, storage: st, fileExists: (p) => p.indexOf('/userData/') === 0 });
  assert.eq(await fm.load('lxgw'), true, '分包来源兜底成功');
  assert.eq(tried.length, 2, '按顺序试了两个来源');
  assert(tried[0].indexOf('/userData/') >= 0, '先试缓存');
  assert(tried[1].indexOf('/packages/fonts/') >= 0, '后试分包');
  assert.eq(st._map.get('landscape.fontLoaded.v3.lxgw'), 1, '成功写缓存标记');
});

test('字体来源-manager 全部来源失败：回退且不抛错、不写标记', async () => {
  const st = memStorage();
  const wxApi = {
    loadSubpackage: (o) => o.fail(new Error('offline')),
    loadFontFace: (o) => o.fail(new Error('offline')),
  };
  const fm = createFontManager({ wxApi, storage: st });
  assert.eq(await fm.load('lxgw'), false, '全失败返回 false');
  assert.eq(fm.isFallback('lxgw'), true, '回退标记');
  assert.eq(st._map.get('landscape.fontLoaded.v3.lxgw'), undefined, '不写已加载标记（下次重试）');
});

test('字体来源-manager 云直链兜底：分包失败后 https 云来源成功', async () => {
  const st = memStorage();
  const tried = [];
  const wxApi = {
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => {
      tried.push(o.source);
      if (o.source.indexOf('https://') >= 0) o.success();
      else o.fail(new Error('pkg fail'));
    },
  };
  const fm = createFontManager({ wxApi, storage: st, cloudBase: 'https://cdn.example.com/fonts/' });
  assert.eq(await fm.load('mashanzheng'), true, '云直链兜底成功');
  assert.eq(tried[tried.length - 1], 'url("https://cdn.example.com/fonts/mashanzheng.woff2")', '最后试的是云直链');
});
