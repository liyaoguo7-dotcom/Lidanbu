/**
 * 礼单簿 · 云函数 api（服务端总入口）
 *
 * 架构（docs/云联调准备.md 第二节）：小程序端不直连数据库（安全规则已关死），
 * 全部请求走本函数；本函数在服务端用 core/ 执行业务逻辑，core/authz 逐条
 * 校验权限。调用者身份只认 cloud.getWXContext().OPENID，绝不信任客户端传参。
 *
 * 调用约定（小程序端 wx.cloud.callFunction({ name:'api', data:{...} })）：
 *   { action: '<模块>.<函数>', args: [...] } → 调 core.<模块>.<函数>(db, openid, ...args)
 *   { action: 'whoami' }                     → { ok:true, data:{ openid } }（管理员初始化/联调用）
 *   { action: 'exportXlsx', eventIds?, includeGifts? } → routes-export 专用路由
 * 返回统一信封：{ ok:true, data } / { ok:false, error:'用户可读文案' }。
 *
 * 部署：core/ 与 config 由 tools/sync-api.sh 同步进本目录（core/、miniprogram/config/），
 * 改 core 后必须重跑同步脚本再部署。依赖：wx-server-sdk + exceljs（导出用）。
 */

const { createExportXlsxHandler } = require('./routes-export');

// 允许远程调用的 core 模块（业务模块，函数签名均为 (db, actorId, ...)）。
// db/config/models/format/payAdapter/ocr/contentSafety 不开放：
// 分别是基础设施、常量、纯工具与适配层，各有自己的入口。
// export 于 2026-10-23 任务AD 加入：只放行 buildExportData（导出页概览的
// 只读聚合，无写操作、无审计写入）；exportData 含实际导出筛选与审计，
// 仍只经 exportXlsx 专用路由调用，不经通用分发。
const ALLOWED_MODULES = [
  'contacts', 'receive', 'gifts', 'stats', 'share', 'quota', 'inviteReward',
  'payment', 'points', 'admin', 'restriction', 'users', 'account', 'notify',
  'feedback', 'audit', 'importer', 'export',
];

/** 服务端静默建号（与小程序端 data-service.ensureUser 同口径）：
 * 首次调用时建 users 文档（_id=openid）并发注册赠送积分（幂等，只发一次）。
 * 业务函数普遍假设用户文档已存在（如 quota 按 user._id 计额度），缺了会空指针。 */
async function ensureServerUser(db, core, openid) {
  const col = db.collection(core.models.COLLECTIONS.User);
  const user = await col.findOne({ _id: openid });
  if (user) return user;
  const doc = {
    _id: openid,
    profile: { nickname: '', avatarUrl: '' },
    createdAt: Date.now(),
    membership: { status: 'free', expireAt: null },
  };
  await col.insert(doc);
  try { await core.points.grantRegisterBonus(db, openid, core.config); } catch (e) { /* 赠送失败不拦主流程 */ }
  return doc;
}

/** 依赖注入工厂（本地测试用假 SDK 在进程内跑通全链路；云端用默认导出） */
function createMain({ sdk, core, db, buildXlsx, uploadFile }) {
  // 导出处理器懒加载：buildXlsx 依赖 exceljs（体积大、加载慢），绝不能在
  // 函数冷启动时就 require——2026-10-23 真云端实测：急切加载导致 whoami
  // 这种空动作也在默认 3 秒超时内回不来。只有真来 exportXlsx 动作时才装配。
  let _exportXlsx = null;
  const getExportXlsx = () => {
    if (!_exportXlsx) {
      // 上传器：优先用注入的；否则从 sdk 派生（wx-server-sdk 的 uploadFile，
      // 任务AE：导出文件落云存储、回 fileId 给小程序端下载）
      let up = uploadFile;
      if (!up && sdk && typeof sdk.uploadFile === 'function') {
        up = async (cloudPath, fileContent) => {
          const r = await sdk.uploadFile({ cloudPath, fileContent });
          return r && r.fileID;
        };
      }
      _exportXlsx = createExportXlsxHandler({
        db,
        buildXlsx: buildXlsx || require('./core/export-xlsx').buildXlsx,
        uploadFile: up,
      });
    }
    return _exportXlsx;
  };

  return async function main(event = {}) {
    const { OPENID } = sdk.getWXContext();
    const action = event.action || '';
    try {
      if (action === 'whoami') {
        return { ok: true, data: { openid: OPENID } };
      }
      if (action === 'exportXlsx') {
        const r = await getExportXlsx()(event, { openid: OPENID });
        // routes-export 自有信封是 { ok:false, reason }，在这里归一化为全站统一的 error 字段
        if (r && r.ok === false && r.reason && !r.error) return { ok: false, error: r.reason };
        return r;
      }
      const dot = action.indexOf('.');
      const modName = dot > 0 ? action.slice(0, dot) : '';
      const fnName = dot > 0 ? action.slice(dot + 1) : '';
      if (!ALLOWED_MODULES.includes(modName)) {
        return { ok: false, error: `未知action：${action}` };
      }
      const fn = core[modName] && core[modName][fnName];
      if (typeof fn !== 'function') {
        return { ok: false, error: `未知action：${action}` };
      }
      const args = Array.isArray(event.args) ? event.args : [];
      // 支付适配器不能跨 RPC 序列化（任务AD）：payment.purchase /
      // purchasePointsPack 在服务端注入与小程序端本地演示同口径的
      // MockPayAdapter（模拟支付，真实通道未接入前两边行为一致）。
      // 真实支付通道接入时，只改这里：换成 WechatVirtualPayAdapter。
      if (modName === 'payment' && (fnName === 'purchase' || fnName === 'purchasePointsPack')) {
        const opts = (args[1] && typeof args[1] === 'object') ? args[1] : {};
        opts.adapter = new core.payAdapter.MockPayAdapter({ result: 'success' });
        args[1] = opts;
      }
      await ensureServerUser(db, core, OPENID);
      const data = await fn(db, OPENID, ...args);
      // importer.writeImport 的失败以 { rawError } 形态返回（非抛错）：Error
      // 对象过不了云端序列化，这里归一化为普通对象 {message, code, itemIndex}，
      // 小程序端据此还原文案/错误码/出错条目下标（与本地口径一致）。
      if (data && data.rawError instanceof Error) {
        const re = data.rawError;
        data.rawError = {
          message: re.message || '操作失败，请重试',
          code: re.code,
          itemIndex: Number.isInteger(re.itemIndex) ? re.itemIndex : undefined,
        };
      }
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      // core 抛出的均为用户可读文案（errors.js 口径）；未知错误只回通用文案，不漏内部细节。
      // 带机器错误码的错误（errors.js 的 permDenied/quotaDenied 等）其消息即
      // 设计给用户看的文案（如额度卖惨文案，无冒号），原样透出；无码的未知
      // 错误才走"含冒号且短"的启发式，防内部细节外漏（任务AD 回环测试坐实）。
      const msg = (err && err.message) || '操作失败，请重试';
      const coded = err && typeof err.code === 'string';
      const out = { ok: false, error: coded || (/[:：]/.test(msg) && msg.length <= 120) ? msg : '操作失败，请重试' };
      // 机器可读错误码透传（任务AD）：小程序端页面按 code 分流提示
      // （如 member-required / insufficient-points / plan-not-found），与本地口径一致
      if (err && typeof err.code === 'string') out.code = err.code;
      return out;
    }
  };
}

let _main = null;
function lazyMain() {
  if (_main) return _main;
  // eslint-disable-next-line global-require
  const sdk = require('wx-server-sdk');
  sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV });
  // eslint-disable-next-line global-require
  const core = require('./core');
  const db = new core.db.CloudDB({ sdk });
  _main = createMain({ sdk, core, db });
  return _main;
}

exports.main = async (event, context) => lazyMain()(event, context);
exports.createMain = createMain;
