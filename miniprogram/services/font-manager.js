/**
 * 礼单簿 · 横置礼单本字体管理器
 *
 * 方案（已定版「替代 A：常用字预生成包」）：三款字体各一个常用字子集 WOFF2 包
 * （字符集 = 百家姓+高频名用字+大写金额字，约 721 字，字表与构建方法见包内
 * packages/fonts/README.md），用户在样式面板选中哪款才加载哪款，加载成功后
 * 缓存（storage 标记），下次直接用。
 *
 * 字体文件已移入**分包** `packages/fonts`（app.json subpackages，name:"fonts"），
 * 不再占主包体积。来源一律经 services/font-source.js 适配层按优先级取：
 * 云存储临时 https 链接 → 本地分包兜底（2026-10-23 任务AE 改路线：
 * Android 上分包与本地文件两条路都被真机证伪，loadFontFace 只认 https
 * 链接/Data URL，故 cloud:// 字体先换临时链接再加载，细节见 font-source）。
 * 页面与横置代码不得直接引用字体路径，只调本模块接口。
 *
 * 失败/离线行为：load() 永不抛错、永不 reject；所有来源都失败时该字体标记为
 * fallback，页面继续用回退链渲染（所选字体名仍在栈首，未加载时系统自动逐字
 * 回退到楷体/宋体，不出方框），恢复网络后下次进入页面自动重试。
 */
const { FONTS, fontById } = require('../pages/landscape/landscape-core.js');
const { createFontSource, SUBPACKAGE_ROOT } = require('./font-source.js');

/** 本地字体路径前缀（现为分包路径；保留此导出兼容旧引用，来源细节以 font-source 为准） */
const FONT_SRC_BASE = SUBPACKAGE_ROOT;

/** 已加载标记键（带字体构建版本段）：旧版坏字体文件（如 AA 前龙藏 TTF 套 woff2 名）
 * 若曾"加载成功"写下旧键，版本段一变旧键自然失效，强制用当前文件重载
 * （2026-10-22 任务AB 第 6 项：三款字体真机仍不可用的机制修复之一）。
 * 字体文件再重建时必须同步 bump 此版本号。 */
const FONT_BUILD = 'v9'; // v9：AY批字体扩至六款（新增枝芒行书/古典宋体/莫大毛笔，云端 TTF 子集为新文件，强制重载） // v8：AK批分包瘦身（马善政/龙藏删分包 woff2 兜底、只走云端；霞鹜文楷保留）；v7 为服务端代取 Data URL（AH批，已真机验通）；v6 为客户端下载转 Data URL、v5 为 TTF 临时链接优先、v4 为 woff2 临时链接
const LOADED_KEY_PREFIX = `landscape.fontLoaded.${FONT_BUILD}.`;

function defaultStorage() {
  return {
    get(k) { try { return wx.getStorageSync(k); } catch (e) { return ''; } },
    set(k, v) { try { wx.setStorageSync(k, v); } catch (e) { /* 忽略 */ } },
  };
}

/**
 * 工厂（可注入 wx、storage 与 fontSource 便于测试）。
 * wxApi 需提供 loadFontFace({family, source, scopes, success, fail})。
 */
function createFontManager(deps = {}) {
  const wxApi = deps.wxApi || (typeof wx !== 'undefined' ? wx : null);
  const storage = deps.storage || defaultStorage();
  const fontSource = deps.fontSource || createFontSource({ wxApi, storage, cloudBase: deps.cloudBase, fileExists: deps.fileExists });
  const state = {}; // fontId -> 'idle'|'loading'|'loaded'|'failed'
  const failures = {}; // fontId -> {stage:'temp-url'|'load-face', reason}（页面据此给用户看得懂的提示）
  FONTS.forEach((f) => { state[f.id] = storage.get(LOADED_KEY_PREFIX + f.id) ? 'loaded' : 'idle'; });

  function sourceFor(font) {
    return fontSource.subpackageSource(font);
  }

  let lastFaceError = ''; // 最近一次 loadFontFace 失败的原始 errMsg（2026-10-25：此前被直接丢弃，弹窗只能给通用文案、无从定位）

  /** 单个来源的一次 loadFontFace 尝试；返回 Promise<boolean>，永不 reject */
  function tryLoadFace(family, source) {
    return new Promise((resolve) => {
      try {
        wxApi.loadFontFace({
          family,
          source,
          global: true, // 加载成功后全局生效（任务Z 第 7 项：避免只有触发页能用上）
          scopes: ['webview', 'native'],
          success: () => resolve(true),
          fail: (e) => { lastFaceError = (e && (e.errMsg || e.message)) || ''; resolve(false); },
        });
      } catch (e) { lastFaceError = (e && e.message) || ''; resolve(false); }
    });
  }

  /**
   * 加载指定字体（选中才调用）。返回 Promise<boolean> 是否已就绪；永不 reject。
   * 已 loaded 直接返回 true；按 font-source 的优先级逐个来源尝试，首成即止；
   * 全部失败记 'failed'（不粘滞到 storage，下次调用自动重试）。
   */
  function load(fontId) {
    const font = fontById(fontId);
    if (state[font.id] === 'loaded') return Promise.resolve(true);
    if (!wxApi || typeof wxApi.loadFontFace !== 'function') {
      state[font.id] = 'failed';
      return Promise.resolve(false);
    }
    state[font.id] = 'loading';
    return (async () => {
      const candidates = fontSource.resolveCandidates(font);
      let attemptFailure = null; // 本次尝试里最有信息量的失败（云端换链优先于分包兜底）
      for (const cand of candidates) {
        let source = cand.source || null;
        if (cand.needsSubpackage) await fontSource.ensureSubpackage(); // 尽力触发分包下载，成败都继续尝试
        if (cand.needsApiData) {
          source = typeof fontSource.materializeApiData === 'function'
            ? await fontSource.materializeApiData(cand) : null;
          if (!source) {
            const me = typeof fontSource.getLastMaterializeError === 'function'
              ? fontSource.getLastMaterializeError() : null;
            attemptFailure = { stage: 'api-data', reason: (me && me.reason) || '服务端取字体失败' };
            continue;
          }
        }
        if (cand.needsDataUrl) {
          source = typeof fontSource.materializeDataUrl === 'function'
            ? await fontSource.materializeDataUrl(cand) : null;
          if (!source) {
            const me = typeof fontSource.getLastMaterializeError === 'function'
              ? fontSource.getLastMaterializeError() : null;
            attemptFailure = { stage: 'data-url', reason: (me && me.reason) || '下载字体文件失败' };
            continue;
          }
        }
        if (cand.needsTempUrl) {
          source = await fontSource.materialize(cand, font); // 云存储 fileID → 临时 https 链接
          if (!source) {
            const me = typeof fontSource.getLastMaterializeError === 'function'
              ? fontSource.getLastMaterializeError() : null;
            if (!attemptFailure) attemptFailure = { stage: 'temp-url', reason: (me && me.reason) || '换链接失败' };
            continue;
          }
        }
        if (!source) continue;
        // eslint-disable-next-line no-await-in-loop
        const ok = await tryLoadFace(font.family, source);
        if (ok) {
          state[font.id] = 'loaded';
          delete failures[font.id];
          storage.set(LOADED_KEY_PREFIX + font.id, 1); // 缓存标记：下次免重复加载
          return true;
        }
        if (!attemptFailure) attemptFailure = { stage: 'load-face', reason: lastFaceError || '字体文件已取到，但手机未能加载' };
      }
      if (attemptFailure) failures[font.id] = attemptFailure;
      state[font.id] = 'failed';
      return false;
    })();
  }

  return {
    load,
    /** 确保当前所选字体就绪（页面 onShow 调；其余字体不预下载，省流量/包体积） */
    ensureSelected(fontId) { return load(fontId); },
    getState(fontId) { return state[fontById(fontId).id]; },
    /** 最近一次加载失败的阶段与原始原因（成功后清除）；页面提示/排查用 */
    getLastFailure(fontId) { return failures[fontById(fontId).id] || null; },
    /** 是否处于回退状态（加载失败或从未加载成功）：页面据此仍用同一回退链渲染，不阻断 */
    isFallback(fontId) { return state[fontById(fontId).id] !== 'loaded'; },
    sourceFor,
    fontSource,
    FONT_SRC_BASE,
  };
}

let _default = null;
function defaultManager() {
  if (!_default) _default = createFontManager();
  return _default;
}

module.exports = {
  createFontManager,
  FONT_SRC_BASE,
  FONT_BUILD,
  LOADED_KEY_PREFIX,
  /** 页面便捷入口：确保所选字体就绪（永不抛错） */
  ensureSelected(fontId) { return defaultManager().ensureSelected(fontId); },
  isFallback(fontId) { return defaultManager().isFallback(fontId); },
  getState(fontId) { return defaultManager().getState(fontId); },
  /** 最近一次加载失败的阶段与原始原因（2026-10-25 补导出：此前实例方法未挂到
   * 模块层，book-common 的 typeof 守卫恒为 false、弹窗永远走通用文案） */
  getLastFailure(fontId) { return defaultManager().getLastFailure(fontId); },
};
