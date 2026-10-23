/**
* 礼单簿 · 横置字体「来源适配层」（font-source）
*
* 职责：只回答一个问题——某款字体按什么顺序、从哪些来源去加载。
* 页面与横置代码不许直接引用字体文件路径，一律经 font-manager → 本模块取来源。
*
* （resolveCandidates 返回的顺序，font-manager 逐个尝试、首成即止）
* 1. cache 已缓存文件：云下载成功后持久化到用户数据区的副本
* （wx.env.USER_DATA_PATH/landscape-fonts/<file>，storage 记路径）。
* 跨启动可直接用，不依赖分包是否已下载、也不耗流量。
* 2. cloud 云存储：常量 CLOUD_FONT_BASE 为空 = 未启用，直接跳过（不产生候选）。
* 填入后自动启用且**优先于分包**（2026-10-23 任务AC 第 8 项改序），两种形态：
* - https://…/ 直链：loadFontFace 直接加载该 URL（须把域名加进小程序
* 后台「服务器域名」downloadFile 合法域名，且字体服务需开 CORS）。
* - cloud://… 云存储 fileID 前缀：wx.cloud.downloadFile 取临时文件
* → loadFontFace 临时路径，并顺手把副本持久化到用户数据区，
* 下次走优先级 1（断网可用）。
* 3. subpackage 本地分包（兜底）：/packages/fonts/<file>（三款子集 WOFF2
* 所在分包，app.json subpackages name:"fonts"）。尝试前先 ensureSubpackage()
* 触发分包下载（另有 preloadRule 在收礼/我的页 wifi 下预下载）。
* 【为何分包降为兜底】微信官方《分包加载》文档 Known BUG 原文：
* "Currently Android can't load the font file under the subpackage"——
* Android 微信根本加载不了分包内字体文件，与加载代码无关（用户手机为
* Android，三款字体真机不可用的真因）；且 wx.loadFontFace 官方口径
* source 只支持 https 链接或 Data URL。分包仅保留作 iOS/工具兜底。
*
*
* - 分包打包/引用原则（微信官方《分包加载》）：分包可引用主包与本包资源，
* 主包页面对分包资源的运行时引用需以分包已下载为前提——故本地分包来源前
* 先 ensureSubpackage，且跨包 loadFontFace 的真机行为列为联调验证项；
* 即便本地分包来源在个别机型失败，链上还有云来源与回退链兜底，不阻断页面。
* - 纯资源分包（pages:[]）为现行通行结构；开发者工具上传校验列为联调验证项，
* 若个别工具版本不接受空 pages，后备方案是给分包加一个空白占位页。
* - 所有方法永不抛错：任何一步失败都只是"少一个候选/该候选失败"，由
* font-manager 继续下一个来源，最终回退系统楷体/宋体（不出方框）。
*/

/** 分包名（与 app.json subpackages[].name 一致） */
const SUBPACKAGE_NAME = 'fonts';
/** 分包内字体目录的包内绝对路径前缀 */
const SUBPACKAGE_ROOT = '/packages/fonts/';
/**
* 云存储字体地址前缀：留空 = 未启用云来源（保持空字符串，打包前由主代理填入）。
* 填入后云来源自动启用且**优先于分包**（任务AC 第 8 项：Android 微信有官方
* Known BUG，加载不了分包内字体文件，云来源是 Android 的唯一正路）。
* 启用时填：https 直链目录（如 'https://cdn.example.com/fonts/'）
* 或云存储 fileID 目录（如 'cloud://env-id.bucket-id/fonts/'），末尾斜杠可有可无。
*/
const CLOUD_FONT_BASE = 'cloud://cloud1-d3gd7fjdx0d217df0.636c-cloud1-d3gd7fjdx0d217df0-1514234749/fonts/';
/** 用户数据区内的字体缓存目录名 */
const USER_CACHE_DIR = 'landscape-fonts';
/** storage 键前缀：fontId -> 已缓存文件的绝对路径 */
const CACHE_FILE_KEY_PREFIX = 'landscape.fontCacheFile.';

function defaultStorage(wxApi) {
return {
get(k) { try { return wxApi.getStorageSync(k);} catch (e) { return '';}},
set(k, v) { try { wxApi.setStorageSync(k, v);} catch (e) { /* 忽略 */}},
};
}

function joinUrl(base, file) {
return String(base).replace(/\/*$/, '/') + file;
}

/**
* 工厂（可注入便于测试）。
* deps: { wxApi, storage, cloudBase, fileExists(path)->bool}
*/
function createFontSource(deps = {}) {
const wxApi = deps.wxApi || (typeof wx!== 'undefined'? wx: null);
const storage = deps.storage || (wxApi? defaultStorage(wxApi): { get() { return '';}, set() {}});
const cloudBase = deps.cloudBase!== undefined? String(deps.cloudBase || ''): CLOUD_FONT_BASE;
const fileExists = deps.fileExists || ((p) => {
try {
if (!wxApi || typeof wxApi.getFileSystemManager!== 'function') return false;
wxApi.getFileSystemManager().accessSync(p);
return true;
} catch (e) { return false;}
});

let subpackageReady = null; // 本会话内 ensureSubpackage 的结果（Promise<boolean>，只算一次）

/** 分包内字体文件的包内绝对路径 */
function subpackagePath(font) { return SUBPACKAGE_ROOT + font.file;}
/** loadFontFace 用的分包来源串 */
function subpackageSource(font) { return `url("${subpackagePath(font)}")`;}

function isCloudEnabled() { return!!cloudBase;}
function isCloudFileMode() { return cloudBase.indexOf('cloud://') === 0;}

/** 优先级1：用户数据区缓存文件路径（storage 有记录且文件确实还在） */
function cachedFilePath(font) {
const p = storage.get(CACHE_FILE_KEY_PREFIX + font.id);
if (p && fileExists(p)) return p;
return null;
}

/**
* 按优先级列出候选来源（同步部分；任务AC 第 8 项改序：缓存 → 云 → 分包）：
* [{kind:'cache', source, path}?,
* {kind:'cloud-url', source} | {kind:'cloud-file', fileID}?,
* {kind:'subpackage', source, path, needsSubpackage:true}]
* 云未启用（CLOUD_FONT_BASE 空）时不产生云候选。
*/
function resolveCandidates(font) {
const list = [];
const cached = cachedFilePath(font);
if (cached) list.push({ kind: 'cache', source: `url("${cached}")`, path: cached});
if (isCloudEnabled()) {
if (isCloudFileMode()) list.push({ kind: 'cloud-file', fileID: joinUrl(cloudBase, font.file)});
else list.push({ kind: 'cloud-url', source: `url("${joinUrl(cloudBase, font.file)}")`});
}
list.push({ kind: 'subpackage', source: subpackageSource(font), path: subpackagePath(font), needsSubpackage: true});
return list;
}

/**
* 确保字体分包已下载（wx.loadSubpackage）。返回 Promise<boolean>，永不 reject；
* API 不存在/失败都返回 false（font-manager 会照常尝试本地路径并靠后备来源兜底）。
*/
function ensureSubpackage() {
if (subpackageReady) return subpackageReady;
subpackageReady = new Promise((resolve) => {
if (!wxApi || typeof wxApi.loadSubpackage!== 'function') { resolve(false); return;}
try {
wxApi.loadSubpackage({
name: SUBPACKAGE_NAME,
success: () => resolve(true),
fail: () => resolve(false),
});
} catch (e) { resolve(false);}
});
return subpackageReady;
}

/** 把云下载的临时文件持久化到用户数据区并记 storage；返回目标路径或 null（永不抛错） */
function persistToCache(tempFilePath, font) {
try {
if (!wxApi || typeof wxApi.getFileSystemManager!== 'function' ||!wxApi.env ||!wxApi.env.USER_DATA_PATH) return null;
const fs = wxApi.getFileSystemManager();
const dir = `${wxApi.env.USER_DATA_PATH}/${USER_CACHE_DIR}`;
try { fs.mkdirSync(dir, true);} catch (e) { /* 已存在等情况忽略 */}
const target = `${dir}/${font.file}`;
fs.saveFileSync(tempFilePath, target);
storage.set(CACHE_FILE_KEY_PREFIX + font.id, target);
return target;
} catch (e) { return null;}
}

/**
* 把 cloud-file 候选变为可加载的 source 串：云下载 → 临时路径（并顺手持久化缓存）。
* 成功返回 `url("<临时路径>")`，失败返回 null（永不抛错）。
* 联调点：wx.cloud 需先 wx.cloud.init（云环境 ID 就绪后）；downloadFile 的 fileID
* 形态与云存储目录结构需与后台实际上传位置一致。
*/
function materialize(candidate, font) {
return new Promise((resolve) => {
if (!candidate || candidate.kind!== 'cloud-file') { resolve(null); return;}
if (!wxApi ||!wxApi.cloud || typeof wxApi.cloud.downloadFile!== 'function') { resolve(null); return;}
try {
wxApi.cloud.downloadFile({
fileID: candidate.fileID,
success: (res) => {
const tmp = res && res.tempFilePath;
if (!tmp) { resolve(null); return;}
persistToCache(tmp, font);
resolve(`url("${tmp}")`);
},
fail: () => resolve(null),
});
} catch (e) { resolve(null);}
});
}

return {
resolveCandidates,
ensureSubpackage,
materialize,
cachedFilePath,
subpackagePath,
subpackageSource,
isCloudEnabled,
SUBPACKAGE_NAME,
SUBPACKAGE_ROOT,
CLOUD_FONT_BASE: cloudBase,
CACHE_FILE_KEY_PREFIX,
};
}

module.exports = {
createFontSource,
SUBPACKAGE_NAME,
SUBPACKAGE_ROOT,
CLOUD_FONT_BASE,
USER_CACHE_DIR,
CACHE_FILE_KEY_PREFIX,
};
