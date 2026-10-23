/**
 * 礼单簿 · 导出 xlsx 云函数路由（阶段3补缺）
 *
 * 薄封装：action='exportXlsx' 时调 core 的 buildXlsx 生成真 .xlsx，
 * 成功后写一条 ExportJob（导出历史），返回 { ok, data:{ fileName, fileBase64 } }。
 * 失败返回 { ok:false, reason }，reason 为 core 抛出的用户可读文案
 *（如"无权限：无权导出"），原样透出。
 *
 * 权限与范围筛选全在 core 内（export.checkExportScope）：成员无"可导出"
 * 开关会被拒，成员只能导出已授权部分；本层不做任何数据筛选。
 *
 * 依赖注入便于单测（tests/test-cloud-export.js 用 MemoryDB + 真 buildXlsx）：
 *   const { createExportXlsxHandler } = require('./routes-export');
 *   const handle = createExportXlsxHandler({ db, buildXlsx });
 *   const res = await handle(event, { openid });
 * 其中 openid 在云端取 cloud.getWXContext().OPENID（调用者身份，不信任客户端传参）。
 *
 * 部署说明：core/ 复制进云函数目录后，
 *   buildXlsx = require('./core/export-xlsx').buildXlsx（exceljs 在云函数内运行）。
 * 任务AE 起为正式形态：生成后上传云存储、返回 { fileId }，小程序端凭
 * fileID 走 wx.cloud.downloadFile 下载再 openDocument 预览（页面早已按
 * fileId 写好，骨架期的 base64 返回与它对不上、真机导出必失败——
 * 用户 2026-10-23 实测"云端未返回文件"即此）。未注入 uploadFile 时
 * 回落 base64（仅单测/旧路兼容，生产装配在 index.js 恒注入）。
 */

// 与 core/models.js COLLECTIONS.ExportJob 一致；部署时 core/ 在同目录，
// 此处不跨目录 require，以便本模块可独立单测。
const EXPORT_JOBS = 'exportJobs';

/** 导出范围摘要（与小程序端 data-service.logExportJob 文案风格一致） */
function scopeText(event) {
  const base = Array.isArray(event.eventIds) ? `礼薄${event.eventIds.length}个` : '全部礼薄';
  return event.includeGifts === false ? base : `${base}+送礼`;
}

function createExportXlsxHandler({ db, buildXlsx, uploadFile }) {
  if (!db || typeof buildXlsx !== 'function') {
    throw new Error('createExportXlsxHandler 需要 { db, buildXlsx }');
  }
  return async function handleExportXlsx(event = {}, context = {}) {
    if (event.action !== 'exportXlsx') {
      return { ok: false, reason: `未知action:${event.action}` };
    }
    const actorId = context.openid;
    if (!actorId) return { ok: false, reason: '身份信息缺失，请重新登录' };
    const ownerId = event.ownerId || actorId;
    try {
      const buf = await buildXlsx(db, actorId, ownerId, {
        eventIds: Array.isArray(event.eventIds) ? event.eventIds : null,
        includeGifts: event.includeGifts !== false,
      });
      let data;
      if (typeof uploadFile === 'function') {
        // 正式形态：上传云存储 → 返回 fileId（文件名用 ASCII 路径，展示名在 fileName）
        const cloudPath = `exports/${ownerId}/lidanbu-${Date.now()}.xlsx`;
        const fileId = await uploadFile(cloudPath, Buffer.from(buf));
        if (!fileId) throw new Error('文件上传失败，请稍后重试');
        data = { fileName: '礼单簿导出.xlsx', fileId };
      } else {
        data = { fileName: '礼单簿导出.xlsx', fileBase64: Buffer.from(buf).toString('base64') };
      }
      // 导出历史只记成功：上传失败走 catch，不写 ExportJob（与"拒绝后数据未变"口径一致）
      await db.collection(EXPORT_JOBS).insert({
        ownerId, scope: scopeText(event), status: 'done', createdAt: Date.now(),
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  };
}

module.exports = { createExportXlsxHandler };
