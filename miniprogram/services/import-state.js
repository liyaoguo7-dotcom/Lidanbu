/**
 * 礼单簿 · 拍照导入待确认数据暂存（阶段4）
 *
 * 拍照/识别在 import-home、import-event 完成，结果大（原图路径+条目数组），
 * 不走 URL 参数，用本模块内存暂存后跳 import-review 领取。
 * 纯内存实现（模块单例），小程序页面间共享。
 */
let _pending = null;

function saveImport(p) {
  _pending = p || null;
}

/** 领取并清空；无数据返回 null（调用方据此拦截） */
function takeImport() {
  const p = _pending;
  _pending = null;
  return p;
}

function peekImport() {
  return _pending;
}

module.exports = { saveImport, takeImport, peekImport };
