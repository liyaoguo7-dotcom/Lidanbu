/**
 * 礼单簿 · 横置字体「来源适配层」（font-source）
 *
 * 职责：只回答一个问题——某款字体按什么顺序、从哪些来源去加载。
 * 页面与横置代码不许直接引用字体文件路径，一律经 font-manager → 本模块取来源。
 *
 * 来源优先级（resolveCandidates 返回的顺序，font-manager 逐个尝试、首成即止）：
 * 1. cloud 云存储（常量 CLOUD_FONT_BASE，空 = 未启用、直接跳过）：
 *    - https://…/ 直链：候选直接带 source，loadFontFace 加载该 URL
 *      （须把域名加进小程序后台 downloadFile 合法域名，字体服务需开 CORS）。
 *    - cloud://… 云存储 fileID 前缀：候选带 fileID 与 needsTempUrl 标记，
 *      materialize 时调 wx.cloud.getTempFileURL 换一个临时 https 链接
 *      （官方有效期最长一天）再给 loadFontFace 加载。
 * 2. subpackage 本地分包兜底：packages/fonts/ 内的字体文件路径。
 *    iOS 与开发者工具可用；Android 微信有官方 Known BUG 加载不了分包内
 *    字体文件（见《分包加载》文档），故云来源永远排在分包之前。
 *
 * 路线史（为什么是现在这样）：
 * - 任务AC（2026-10-23）曾走「云存储 downloadFile 下载到用户数据区本地
 *   文件再 loadFontFace」：真机实测 Android 仍加载不出——loadFontFace 对
 *   本地文件路径在 Android 上同样不可靠，与分包同属一条死路。
 * - 任务AE（2026-10-23）改走临时 https 链接：loadFontFace 官方口径只认
 *   https 链接或 Data URL 两种网络来源，这是唯一没被证伪的正路。
 *   代价：不再有本地文件缓存，每次冷启动重新取一次临时链接（一个轻量
 *   云调用）；链接在内存里按会话复用，不重复取。
 */

const SUBPACKAGE_ROOT = '/packages/fonts/';
const SUBPACKAGE_NAME = 'fonts';

/**
 * 云端字体目录（cloud:// fileID 前缀或 https:// 直链前缀，末尾斜杠可有可无）。
 * 2026-10-23 用户已把三款 woff2 上传到云开发环境 cloud1 的云存储 fonts/
 * 文件夹，此为控制台给出的 File ID 前缀（任务AC 第 8 项填入）。
 * 若改为自建 CDN，把这里换成 https:// 前缀即可（候选自动变直链形态）。
 */
const CLOUD_FONT_BASE = 'cloud://cloud1-d3gd7fjdx0d217df0.636c-cloud1-d3gd7fjdx0d217df0-1514234749/fonts/';

function defaultFileExists() {
  return false; // 保守：未知即不存在，候选回落到分包路径
}

function joinUrl(base, file) {
  return `${String(base).replace(/\/+$/, '')}/${file}`;
}

/**
 * 工厂：注入 wxApi / storage / cloudBase 以便测试。
 * - wxApi：需要 cloud.getTempFileURL（cloud:// 形态物化用）与
 *   loadSubpackage（分包触发用）；缺失时对应步骤安全跳过。
 * - storage：{get(k), set(k,v)}（本模块只读历史缓存键做迁移清理，见下）。
 * - cloudBase：字符串或 (font) => 字符串；缺省用 CLOUD_FONT_BASE。
 */
function createFontSource(deps = {}) {
  const wxApi = deps.wxApi || (typeof wx !== 'undefined' ? wx : null);
  const cloudBaseOpt = deps.cloudBase !== undefined ? deps.cloudBase : CLOUD_FONT_BASE;
  const tempUrlMemo = new Map(); // fileID -> tempFileURL（本会话内复用，避免重复取链接）
  // 最近一次换链接失败的原因（{fileID, reason}）：2026-10-24 加——此前所有
  // 失败都被静默吞掉、回落到 Android 已知不可用的分包路线，真机上只表现为
  // 「字体没变」无从定位；现在把云端返回的原始原因留下来供页面提示/排查
  let lastMaterializeError = null;

  function cloudBaseOf(font) {
    const base = typeof cloudBaseOpt === 'function' ? cloudBaseOpt(font) : cloudBaseOpt;
    return typeof base === 'string' ? base.trim() : '';
  }

  function isCloudEnabled() {
    return !!cloudBaseOf({ file: '' });
  }

  function subpackagePath(font) {
    return `${SUBPACKAGE_ROOT}${font.file}`;
  }

  /** 分包候选的来源串（loadFontFace 的 source 参数） */
  function subpackageSource(font) {
    return `url("${subpackagePath(font)}")`;
  }

  /** 云存储 fileID（cloud:// 形态时） */
  function cloudFileID(font) {
    const base = cloudBaseOf(font);
    if (!base.startsWith('cloud://')) return '';
    return joinUrl(base, font.file);
  }

  /**
   * 候选来源列表（按优先级）：
   * - { kind:'cloud-url', source }：https 直链，可直接 loadFontFace；
   * - { kind:'cloud-url', needsTempUrl:true, fileID }：cloud:// 形态，
   *   须先经 materialize 换临时 https 链接；
   * - { kind:'subpackage', source, needsSubpackage:true }：分包兜底。
   */
  function resolveCandidates(font) {
    const out = [];
    const base = cloudBaseOf(font);
    // 云端文件名顺序（2026-10-25 改）：TTF 优先、woff2 次之。背景：云存储
    // 路径与文件已由用户截图核对无误，woff2 临时链接路线真机仍加载不出，
    // 头号嫌疑是 Android 微信内核对 woff2 的支持不稳；TTF 是各内核都稳的
    // 格式（与仓库 woff2 同源转换、字体名/字表逐项复验一致）。
    const cloudFiles = [];
    if (font.cloudFile && font.cloudFile !== font.file) cloudFiles.push(font.cloudFile);
    cloudFiles.push(font.file);
    if (base.startsWith('https://')) {
      for (const f of cloudFiles) out.push({ kind: 'cloud-url', source: `url("${joinUrl(base, f)}")` });
    } else if (base.startsWith('cloud://')) {
      for (const f of cloudFiles) out.push({ kind: 'cloud-url', needsTempUrl: true, fileID: joinUrl(base, f) });
    }
    out.push({ kind: 'subpackage', source: subpackageSource(font), needsSubpackage: true });
    return out;
  }

  /**
   * 把 cloud:// 候选物化成 loadFontFace 能吃的来源串：向云存储换临时
   * https 链接。成功返回 `url("https://…")`；无云 API / 换链失败返回
   * null（font-manager 据此跳到下一个候选）。永不抛错。
   */
  async function materialize(cand) {
    if (!cand || cand.kind !== 'cloud-url' || !cand.needsTempUrl || !cand.fileID) return null;
    if (tempUrlMemo.has(cand.fileID)) return `url("${tempUrlMemo.get(cand.fileID)}")`;
    const cloud = wxApi && wxApi.cloud;
    if (!cloud || typeof cloud.getTempFileURL !== 'function') {
      lastMaterializeError = { fileID: cand.fileID, reason: '云存储接口不可用' };
      return null;
    }
    try {
      const res = await new Promise((resolve, reject) => {
        cloud.getTempFileURL({
          fileList: [cand.fileID],
          success: resolve,
          fail: reject,
        });
      });
      const item = res && Array.isArray(res.fileList) ? res.fileList[0] : null;
      const url = item && item.status === 0 && item.tempFileURL ? String(item.tempFileURL) : '';
      if (!url.startsWith('https://')) {
        lastMaterializeError = {
          fileID: cand.fileID,
          reason: (item && (item.errMsg || item.error)) || `云端返回状态 ${item ? item.status : '无结果'}`,
        };
        return null;
      }
      lastMaterializeError = null;
      tempUrlMemo.set(cand.fileID, url);
      return `url("${url}")`;
    } catch (e) {
      lastMaterializeError = { fileID: cand.fileID, reason: (e && (e.errMsg || e.message)) || '换链接请求失败' };
      return null;
    }
  }

  /**
   * 尽力预下载字体分包（loadFontFace 取分包内文件前最好先触发）。
   * 成功返回 true；API 不存在/失败返回 false，不抛错（管理器随后仍会尝试
   * loadFontFace，真失败再回落）。
   */
  function ensureSubpackage() {
    return new Promise((resolve) => {
      try {
        if (!wxApi || typeof wxApi.loadSubpackage !== 'function') { resolve(false); return; }
        wxApi.loadSubpackage({
          name: SUBPACKAGE_NAME,
          success: () => resolve(true),
          fail: () => resolve(false),
        });
      } catch (e) { resolve(false); }
    });
  }

  return {
    resolveCandidates,
    materialize,
    getLastMaterializeError: () => lastMaterializeError,
    ensureSubpackage,
    subpackagePath,
    subpackageSource,
    cloudFileID,
    isCloudEnabled,
    SUBPACKAGE_NAME,
    SUBPACKAGE_ROOT,
    CLOUD_FONT_BASE,
  };
}

module.exports = {
  createFontSource,
  SUBPACKAGE_ROOT,
  SUBPACKAGE_NAME,
  CLOUD_FONT_BASE,
};
