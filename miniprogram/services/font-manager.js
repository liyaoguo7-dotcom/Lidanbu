/**
 * 礼单簿 · 横置礼单本字体管理器
 *
 * 方案（已定版「替代 A：常用字预生成包」）：三款字体各一个常用字子集 WOFF2 包
 * （miniprogram/assets/fonts/，字符集 = 百家姓+高频名用字+大写金额字，约 721 字），
 * 用户在样式面板选中哪款才加载哪款，加载成功后缓存（storage 标记），下次直接用。
 *
 * ⚠️ FONT_SRC_BASE 现在是本地包路径占位常量。上线前必须换成云存储地址：
 *   1) 把 assets/fonts/*.woff2 上传云存储；
 *   2) 把 FONT_SRC_BASE 改为该 https 地址（wx.loadFontFace 远程字体要求 https，
 *      且域名需在小程序后台「服务器域名」downloadFile 合法域名内——待云联调时办）。
 *
 * 失败/离线行为：load() 永不抛错、永不 reject；失败时该字体标记为 fallback，
 * 页面继续用回退链渲染（所选字体名仍在栈首，未加载时系统自动逐字回退到
 * 楷体/宋体，不出方框），恢复网络后下次进入页面自动重试。
 */
const { FONTS, fontById } = require('../pages/landscape/landscape-core.js');

/** 字体包地址前缀（占位：本地包路径；上线换云存储 https 地址，见文件头） */
const FONT_SRC_BASE = '/assets/fonts/';

const LOADED_KEY_PREFIX = 'landscape.fontLoaded.';

function defaultStorage() {
  return {
    get(k) { try { return wx.getStorageSync(k); } catch (e) { return ''; } },
    set(k, v) { try { wx.setStorageSync(k, v); } catch (e) { /* 忽略 */ } },
  };
}

/**
 * 工厂（可注入 wx 与 storage 便于测试）。
 * wxApi 需提供 loadFontFace({family, source, scopes, success, fail})。
 */
function createFontManager(deps = {}) {
  const wxApi = deps.wxApi || (typeof wx !== 'undefined' ? wx : null);
  const storage = deps.storage || defaultStorage();
  const state = {}; // fontId -> 'idle'|'loading'|'loaded'|'failed'
  FONTS.forEach((f) => { state[f.id] = storage.get(LOADED_KEY_PREFIX + f.id) ? 'loaded' : 'idle'; });

  function sourceFor(font) {
    return `url("${FONT_SRC_BASE}${font.file}")`;
  }

  /**
   * 加载指定字体（选中才调用）。返回 Promise<boolean> 是否已就绪；永不 reject。
   * 已 loaded 直接返回 true；加载中/失败的下次调用会重试（失败不粘滞到 storage）。
   */
  function load(fontId) {
    const font = fontById(fontId);
    if (state[font.id] === 'loaded') return Promise.resolve(true);
    if (!wxApi || typeof wxApi.loadFontFace !== 'function') {
      state[font.id] = 'failed';
      return Promise.resolve(false);
    }
    state[font.id] = 'loading';
    return new Promise((resolve) => {
      try {
        wxApi.loadFontFace({
          family: font.family,
          source: sourceFor(font),
          scopes: ['webview', 'native'],
          success: () => {
            state[font.id] = 'loaded';
            storage.set(LOADED_KEY_PREFIX + font.id, 1); // 缓存标记：下次免重复加载
            resolve(true);
          },
          fail: () => {
            state[font.id] = 'failed'; // 只记运行时状态，不写 storage，下次自动重试
            resolve(false);
          },
        });
      } catch (e) {
        state[font.id] = 'failed';
        resolve(false);
      }
    });
  }

  return {
    load,
    /** 确保当前所选字体就绪（页面 onShow 调；其余字体不预下载，省流量/包体积） */
    ensureSelected(fontId) { return load(fontId); },
    getState(fontId) { return state[fontById(fontId).id]; },
    /** 是否处于回退状态（加载失败或从未加载成功）：页面据此仍用同一回退链渲染，不阻断 */
    isFallback(fontId) { return state[fontById(fontId).id] !== 'loaded'; },
    sourceFor,
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
  LOADED_KEY_PREFIX,
  /** 页面便捷入口：确保所选字体就绪（永不抛错） */
  ensureSelected(fontId) { return defaultManager().ensureSelected(fontId); },
  isFallback(fontId) { return defaultManager().isFallback(fontId); },
  getState(fontId) { return defaultManager().getState(fontId); },
};
