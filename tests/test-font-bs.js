/**
 * BS批字体切换修（2026-10-28，用户定：一次性预载＋加载提示＋防重复）：
 * ① 冷启动不再凭 storage 旧标记跳过真实加载（loadFontFace 注册只活本会话，
 *    跳过会导致回退链渲染、莫大毛笔看起来像别的字体）；
 * ② 并发点两次同一字体只跑一路加载；
 * ③ ensureAllFonts 一次预载 6 款主字体；
 * ④ 横置页切换：加载提示＋面板锁＋缓存重排（静态断言）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const { createFontManager } = require('../miniprogram/services/font-manager.js');
const { fontById } = require('../miniprogram/pages/landscape/landscape-core.js');

function memStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : ''), set: (k, v) => m.set(k, v), _map: m };
}

function httpsWx(onFace) {
  return {
    loadFontFace: (o) => { onFace(o); o.success(); },
    loadSubpackage: (o) => o.success(),
  };
}

test('BS-冷启动：storage 里有旧已加载标记也不能跳过真实 loadFontFace', async () => {
  const st = memStorage();
  st.set('landscape.fontLoaded.v9.bakudai', 1); // 上一会话成功过
  let calls = 0;
  const fm = createFontManager({
    wxApi: httpsWx(() => { calls += 1; }),
    storage: st, cloudBase: 'https://cdn.example.com/fonts/',
  });
  assert.eq(await fm.load('bakudai'), true, '应真实加载成功');
  assert.eq(calls, 1, '必须真实调一次 loadFontFace，不得凭旧标记跳过');
});

test('BS-去重：并发两次 load 同一字体只跑一路 loadFontFace', async () => {
  let calls = 0;
  const wxApi = {
    loadFontFace: (o) => {
      calls += 1;
      setTimeout(() => o.success(), 5); // 故意拖一下，让第二次调用撞上在途状态
    },
    loadSubpackage: (o) => o.success(),
  };
  const fm = createFontManager({ wxApi, storage: memStorage(), cloudBase: 'https://cdn.example.com/fonts/' });
  const [a, b] = await Promise.all([fm.load('longcang'), fm.load('longcang')]);
  assert.eq(a, true, '第一路成功');
  assert.eq(b, true, '第二路复用同一路成功');
  assert.eq(calls, 1, 'loadFontFace 只应调一次');
});

test('BS-预载：ensureAllFonts 一次载齐 6 款主字体', async () => {
  const loaded = [];
  const fm = createFontManager({
    wxApi: httpsWx((o) => { loaded.push(o.family); }),
    storage: memStorage(), cloudBase: 'https://cdn.example.com/fonts/',
  });
  assert.eq(await fm.ensureAllFonts(), true, '6 款应全部成功');
  const { FONTS } = require('../miniprogram/pages/landscape/landscape-core.js');
  for (const f of FONTS) {
    assert(fm.getState(f.id) === 'loaded', `${f.name} 应为 loaded`);
    assert(loaded.includes(f.family), `${f.name} 应真实调过 loadFontFace`);
  }
  assert.eq(loaded.length, 6, '恰好 6 路，不多不少');
});

test('BS-横置页切换：加载提示＋面板锁＋缓存重排＋进页预载（静态断言）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape/book-common.js'), 'utf8');
  assert(src.includes('fontSwitching'), '应有切换锁字段');
  assert(src.includes("if (id === this.data.fontId || this.data.fontSwitching) return"), '切换中再点应挡住');
  assert(src.includes('正在加载字体'), '未加载完应显示加载提示');
  assert(src.includes('wx.hideLoading()'), '结束应关加载提示');
  assert(src.includes('_rebuildFromCache'), '应有缓存重排（不再每次重查云端）');
  assert(src.includes('ensureAllFonts'), '进页/开面板应触发预载');
  assert(src.includes("if (!this._rebuildFromCache(id)) await this.reload()"), '无缓存才回落 reload');
});
