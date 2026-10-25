/**
 * 字体来源适配层测试（任务E：字体包进分包 + font-source 适配层；
 * 任务AE 改路线：cloud:// 字体先换临时 https 链接再 loadFontFace，
 * 本地文件缓存路线已废除——Android 上本地文件与分包同样加载不出）
 * 覆盖：来源优先级（云链接 → 分包兜底）、云地址为空跳过云来源、分包路径、
 * 云两种形态（https 直链 / cloud:// 换临时链接）、materialize 容错与会话复用、
 * ensureSubpackage 容错、font-manager 按序逐个尝试与首成即止。
 */
const { test, assert } = require('./fw');
const { createFontSource, SUBPACKAGE_ROOT } = require('../miniprogram/services/font-source.js');
const { createFontManager } = require('../miniprogram/services/font-manager.js');
const { fontById } = require('../miniprogram/pages/landscape/landscape-core.js');

function memStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : ''), set: (k, v) => m.set(k, v), _map: m };
}
const LXGW = fontById('lxgw');

test('字体来源-AK批瘦身：马善政/龙藏无分包候选、霞鹜文楷保留', () => {
  const src = createFontSource({ storage: memStorage(), cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  const msz = src.resolveCandidates(fontById('mashanzheng'));
  assert(msz.every((c) => c.kind !== 'subpackage'), '马善政候选不得含分包（文件已删）');
  assert.eq(msz.length, 4, '马善政候选数（api＋data＋temp TTF＋temp woff2）');
  const lc = src.resolveCandidates(fontById('longcang'));
  assert(lc.every((c) => c.kind !== 'subpackage'), '龙藏候选不得含分包（文件已删）');
  const lx = src.resolveCandidates(fontById('lxgw'));
  assert.eq(lx[lx.length - 1].kind, 'subpackage', '霞鹜文楷仍以分包兜底');
});

test('字体来源-分包路径正确性：路径与 app.json 分包结构一致', () => {
  const src = createFontSource({ storage: memStorage() });
  assert.eq(src.subpackagePath(LXGW), '/packages/fonts/lxgw-wenkai.woff2', '分包内路径');
  assert.eq(SUBPACKAGE_ROOT, '/packages/fonts/', '分包根前缀');
  assert.eq(src.subpackageSource(LXGW), 'url("/packages/fonts/lxgw-wenkai.woff2")', 'loadFontFace 来源串');
  assert.eq(src.SUBPACKAGE_NAME, 'fonts', '分包名与 app.json 一致');
});

test('字体来源-默认优先级：云未启用时只有分包一个候选', () => {
  const src = createFontSource({ storage: memStorage(), cloudBase: '' });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list.length, 1, '候选数');
  assert.eq(list[0].kind, 'subpackage', '唯一候选是分包');
  assert.eq(list[0].needsSubpackage, true, '分包候选需先触发分包下载');
});

test('字体来源-云地址为空跳过云来源', () => {
  const src = createFontSource({ storage: memStorage(), cloudBase: '' });
  assert.eq(src.isCloudEnabled(), false, '云未启用');
  assert(src.resolveCandidates(LXGW).every((c) => c.kind.indexOf('cloud') !== 0), '候选里没有云来源');
});

test('字体来源-https 云地址：cloud-url 直链候选排在分包之前', () => {
  const src = createFontSource({ storage: memStorage(), cloudBase: 'https://cdn.example.com/fonts' });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list.length, 3, '云端 TTF+woff2 两个候选＋分包兜底（2026-10-25 TTF 优先）');
  assert.eq(list[0].kind, 'cloud-url', '云直链候选排第一');
  assert.eq(list[0].source, 'url("https://cdn.example.com/fonts/lxgw-wenkai.ttf")', 'TTF 直链排第一');
  assert.eq(list[1].source, 'url("https://cdn.example.com/fonts/lxgw-wenkai.woff2")', 'woff2 直链排第二（末尾斜杠自动补）');
  assert.eq(list[2].kind, 'subpackage', '分包降为兜底排最后');
  assert.eq(list[2].needsSubpackage, true, '分包候选的 needsSubpackage 标记随候选走');
});

test('字体来源-cloud:// 云存储：服务端代取候选排第一、直下载第二、临时链接次之、分包兜底', () => {
  const src = createFontSource({ storage: memStorage(), cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  const list = src.resolveCandidates(LXGW);
  assert.eq(list.length, 5, '候选数（api＋data＋temp TTF＋temp woff2＋分包）');
  assert.eq(list[0].kind, 'cloud-api', '服务端代取候选排第一（2026-10-25 AH批 v7 路线）');
  assert.eq(list[0].needsApiData, true, '第一候选须先经云函数取代取');
  assert.eq(list[0].fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', '代取候选指向 TTF');
  assert.eq(list[1].kind, 'cloud-data', '客户端直下载转 Data URL 候选排第二（v6 路线保留）');
  assert.eq(list[1].needsDataUrl, true, '第二候选须先下载转码');
  assert.eq(list[1].fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', 'Data 候选指向 TTF');
  assert.eq(list[0].source, undefined, '来源串不可预先写死在候选里');
  assert.eq(list[2].kind, 'cloud-url', '临时链接候选排第三');
  assert.eq(list[2].needsTempUrl, true, 'cloud:// 形态须先换临时链接');
  assert.eq(list[2].fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', 'TTF 临时链接排第三');
  assert.eq(list[3].fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.woff2', 'woff2 临时链接排第四');
  assert.eq(list[4].kind, 'subpackage', '分包兜底排最后');
  assert.eq(src.cloudFileID(LXGW), 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.woff2', 'cloudFileID 拼装');
});

test('字体来源-materialize：cloud:// 候选换临时 https 链接；会话内复用不重复换', async () => {
  let calls = 0;
  const wxApi = {
    cloud: {
      getTempFileURL: (o) => {
        calls += 1;
        assert.eq(o.fileList[0], 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', '换链入参为 TTF 的 fileID');
        o.success({ fileList: [{ fileID: o.fileList[0], tempFileURL: 'https://tmp.example.com/f.woff2?sign=x', status: 0 }] });
      },
    },
  };
  const src = createFontSource({ storage: memStorage(), wxApi, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  const cand = src.resolveCandidates(LXGW).find((c) => c.needsTempUrl);
  const s1 = await src.materialize(cand, LXGW);
  assert.eq(s1, 'url("https://tmp.example.com/f.woff2?sign=x")', '物化为临时 https 来源串');
  const s2 = await src.materialize(cand, LXGW);
  assert.eq(s2, s1, '第二次同结果');
  assert.eq(calls, 1, '同会话同文件只换一次链');
});

test('字体来源-materialize 容错：无云 API / 换链失败 / 状态非 0 一律回 null 不抛错', async () => {
  const noCloud = createFontSource({ storage: memStorage(), wxApi: {}, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await noCloud.materialize(noCloud.resolveCandidates(LXGW).find((c) => c.needsTempUrl), LXGW), null, '无 getTempFileURL 回 null');
  const failApi = { cloud: { getTempFileURL: (o) => o.fail(new Error('denied')) } };
  const failSrc = createFontSource({ storage: memStorage(), wxApi: failApi, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await failSrc.materialize(failSrc.resolveCandidates(LXGW).find((c) => c.needsTempUrl), LXGW), null, '换链失败回 null');
  const badStatus = { cloud: { getTempFileURL: (o) => o.success({ fileList: [{ status: -501007, tempFileURL: '' }] }) } };
  const badSrc = createFontSource({ storage: memStorage(), wxApi: badStatus, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await badSrc.materialize(badSrc.resolveCandidates(LXGW).find((c) => c.needsTempUrl), LXGW), null, '状态非 0 回 null');
  const sub = createFontSource({ storage: memStorage(), cloudBase: '' });
  assert.eq(await sub.materialize(sub.resolveCandidates(LXGW)[0], LXGW), null, '分包候选不走 materialize');
});

test('字体来源-ensureSubpackage：成功回 true、无 API 安全回 false', async () => {
  const okSrc = createFontSource({ storage: memStorage(), wxApi: { loadSubpackage: (o) => o.success() } });
  assert.eq(await okSrc.ensureSubpackage(), true, '分包下载成功');
  const noApiSrc = createFontSource({ storage: memStorage(), wxApi: {} });
  assert.eq(await noApiSrc.ensureSubpackage(), false, '无 loadSubpackage 时返回 false 不抛错');
  const failSrc = createFontSource({ storage: memStorage(), wxApi: { loadSubpackage: (o) => o.fail(new Error('net')) } });
  assert.eq(await failSrc.ensureSubpackage(), false, '分包下载失败返回 false 不抛错');
});

test('字体来源-manager 按优先级逐个尝试：临时链接失败才试分包，首成即止', async () => {
  const st = memStorage();
  const tried = [];
  const wxApi = {
    cloud: { getTempFileURL: (o) => o.success({ fileList: [{ fileID: o.fileList[0], tempFileURL: 'https://tmp.example.com/x.woff2', status: 0 }] }) },
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => {
      tried.push(o.source);
      if (o.source.indexOf('/packages/fonts/') >= 0) o.success();
      else o.fail(new Error('tmp url rejected'));
    },
  };
  const fm = createFontManager({ wxApi, storage: st, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  assert.eq(await fm.load('lxgw'), true, '分包来源兜底成功');
  assert.eq(tried.length, 3, '按顺序试了三个来源（TTF 临时链接→woff2 临时链接→分包）');
  assert(tried[0].indexOf('https://tmp.example.com/') >= 0, '先试云临时链接');
  assert(tried[2].indexOf('/packages/fonts/') >= 0, '最后试分包');
  assert.eq(st._map.get('landscape.fontLoaded.v8.lxgw'), 1, '成功写缓存标记（v8 构建段）');
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
  assert.eq(st._map.get('landscape.fontLoaded.v8.lxgw'), undefined, '不写已加载标记（下次重试）');
});

test('字体来源-manager 云优先：云直链排在分包之前、首试即成', async () => {
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
  assert.eq(await fm.load('mashanzheng'), true, '云直链首试成功');
  assert.eq(tried.length, 1, '云排在分包之前，首试即成、不再试分包');
  assert.eq(tried[0], 'url("https://cdn.example.com/fonts/mashanzheng.ttf")', '第一个试的就是云直链（TTF 优先）');
});

test('字体来源-manager cloud:// 形态：先换临时链接再 loadFontFace（任务AE 主路线）', async () => {
  const st = memStorage();
  const tried = [];
  const wxApi = {
    cloud: { getTempFileURL: (o) => o.success({ fileList: [{ fileID: o.fileList[0], tempFileURL: 'https://tmp.example.com/m.woff2', status: 0 }] }) },
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => { tried.push(o.source); o.success(); },
  };
  const fm = createFontManager({ wxApi, storage: st, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  assert.eq(await fm.load('mashanzheng'), true, '临时链接加载成功');
  assert.eq(tried.length, 1, '只试临时链接一个来源即成');
  assert.eq(tried[0], 'url("https://tmp.example.com/m.woff2")', 'loadFontFace 吃的是 https 链接，不是本地路径');
  assert.eq(st._map.get('landscape.fontLoaded.v8.mashanzheng'), 1, '成功写 v8 标记');
});

test('字体来源-materializeDataUrl：下载 TTF→读 base64→Data URL 来源串；会话内复用不重复下载', async () => {
  let downloads = 0;
  const wxApi = {
    cloud: {
      downloadFile: (o) => {
        downloads += 1;
        assert.eq(o.fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', '下载入参为 TTF 的 fileID');
        o.success({ tempFilePath: 'wxfile://tmp/font.ttf' });
      },
    },
    getFileSystemManager: () => ({
      readFile: (o) => {
        assert.eq(o.filePath, 'wxfile://tmp/font.ttf', '读的是刚下载的临时文件');
        assert.eq(o.encoding, 'base64', '按 base64 读');
        o.success({ data: 'QUJD' });
      },
    }),
  };
  const src = createFontSource({ storage: memStorage(), wxApi, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  const cand = src.resolveCandidates(LXGW).find((c) => c.needsDataUrl);
  assert.eq(cand.kind, 'cloud-data', '按标记取到 cloud-data 候选');
  const s1 = await src.materializeDataUrl(cand);
  assert.eq(s1, 'url("data:font/ttf;base64,QUJD")', '物化为 Data URL 来源串（不经网络取字体）');
  const s2 = await src.materializeDataUrl(cand);
  assert.eq(s2, s1, '第二次同结果');
  assert.eq(downloads, 1, '同会话同文件只下载一次');
});

test('字体来源-materializeDataUrl 容错：无接口/下载失败回 null 并留原因', async () => {
  const noApi = createFontSource({ storage: memStorage(), wxApi: {}, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await noApi.materializeDataUrl(noApi.resolveCandidates(LXGW).find((c) => c.needsDataUrl)), null, '无 downloadFile 回 null');
  assert(/接口不可用/.test(noApi.getLastMaterializeError().reason), '原因应写明接口不可用');
  const failApi = {
    cloud: { downloadFile: (o) => o.fail({ errMsg: 'downloadFile:fail timeout' }) },
    getFileSystemManager: () => ({ readFile: (o) => o.success({ data: 'QUJD' }) }),
  };
  const failSrc = createFontSource({ storage: memStorage(), wxApi: failApi, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await failSrc.materializeDataUrl(failSrc.resolveCandidates(LXGW).find((c) => c.needsDataUrl)), null, '下载失败回 null');
  assert(/下载字体文件失败/.test(failSrc.getLastMaterializeError().reason), '原因应保留下载失败原文');
});

test('字体来源-materializeApiData：云函数回 base64→Data URL 来源串；会话内复用不重复调用', async () => {
  let calls = 0;
  const wxApi = {
    cloud: {
      callFunction: (o) => {
        calls += 1;
        assert.eq(o.data.fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', '入参为 TTF 的 fileID');
        o.success({ result: { ok: true, data: { base64: 'QUJD', mime: 'font/ttf' } } });
      },
    },
  };
  const src = createFontSource({ storage: memStorage(), wxApi, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  const cand = src.resolveCandidates(LXGW)[0];
  assert.eq(cand.kind, 'cloud-api', '第一候选为 cloud-api');
  const s1 = await src.materializeApiData(cand);
  assert.eq(s1, 'url("data:font/ttf;base64,QUJD")', '物化为 Data URL 来源串');
  const s2 = await src.materializeApiData(cand);
  assert.eq(s2, s1, '第二次同结果');
  assert.eq(calls, 1, '同会话同文件只代取一次');
});

test('字体来源-materializeApiData 容错：无接口/服务端拒绝回 null 并留原因', async () => {
  const noApi = createFontSource({ storage: memStorage(), wxApi: {}, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await noApi.materializeApiData(noApi.resolveCandidates(LXGW)[0]), null, '无 callFunction 回 null');
  assert(/接口不可用/.test(noApi.getLastMaterializeError().reason), '原因应写明接口不可用');
  const denyApi = { cloud: { callFunction: (o) => o.success({ result: { ok: false, error: '云端取字体失败' } }) } };
  const denySrc = createFontSource({ storage: memStorage(), wxApi: denyApi, cloudBase: 'cloud://e.b/fonts/' });
  assert.eq(await denySrc.materializeApiData(denySrc.resolveCandidates(LXGW)[0]), null, '服务端拒绝回 null');
  assert(/服务端取字体失败/.test(denySrc.getLastMaterializeError().reason), '原因应保留服务端文案');
});

test('字体来源-manager 服务端代取首选：云函数回 base64 后 loadFontFace 首试即成', async () => {
  const st = memStorage();
  const tried = [];
  let apiCalls = 0;
  let downloads = 0;
  const wxApi = {
    cloud: {
      callFunction: (o) => {
        apiCalls += 1;
        assert.eq(o.name, 'api', '代取走 api 云函数');
        assert.eq(o.data.action, 'fontFile', '代取动作为 fontFile');
        assert.eq(o.data.fileID, 'cloud://env-1.bucket-x/fonts/lxgw-wenkai.ttf', '代取入参为 TTF 的 fileID');
        o.success({ result: { ok: true, data: { base64: 'QUJD', mime: 'font/ttf' } } });
      },
      downloadFile: (o) => { downloads += 1; o.success({ tempFilePath: 'wxfile://tmp/f.ttf' }); },
      getTempFileURL: (o) => o.success({ fileList: [{ fileID: o.fileList[0], tempFileURL: 'https://tmp.example.com/x.ttf', status: 0 }] }),
    },
    getFileSystemManager: () => ({ readFile: (o) => o.success({ data: 'QUJD' }) }),
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => { tried.push(o.source); o.success(); },
  };
  const fm = createFontManager({ wxApi, storage: st, cloudBase: 'cloud://env-1.bucket-x/fonts/' });
  assert.eq(await fm.load('lxgw'), true, '服务端代取路线加载成功');
  assert.eq(apiCalls, 1, '只调一次云函数代取');
  assert.eq(downloads, 0, '代取成功时不再走客户端直下载');
  assert.eq(tried.length, 1, '首试即成，不再试临时链接/分包');
  assert(tried[0].indexOf('url("data:font/ttf;base64,') === 0, 'loadFontFace 吃的是 Data URL');
});

test('字体来源-manager 失败原因透传：loadFontFace 的 errMsg 记进 getLastFailure；模块层导出存在', async () => {
  const st = memStorage();
  const wxApi = {
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => o.fail({ errMsg: 'loadFontFace:fail data URL rejected' }),
  };
  const fm = createFontManager({ wxApi, storage: st, cloudBase: '' });
  assert.eq(await fm.load('lxgw'), false, '全失败');
  const f = fm.getLastFailure('lxgw');
  assert(f && f.stage === 'load-face' && /data URL rejected/.test(f.reason), '失败原因应为 loadFontFace 原始 errMsg');
  const mod = require('../miniprogram/services/font-manager.js');
  assert.eq(typeof mod.getLastFailure, 'function', '模块层应导出 getLastFailure（book-common 弹窗靠它取原因，曾漏导出导致弹窗恒通用文案）');
});
