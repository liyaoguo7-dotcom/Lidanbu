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
 *   { action: 'fontFile', fileID } → 服务端取字体 TTF 回 base64（AH批：真机实测
 *     小程序端 wx.cloud.downloadFile 对控制台上传的字体文件回「empty download
 *     url」拿不到文件；服务端身份取同一 fileID 正常。仅白名单三款 TTF）
 * 返回统一信封：{ ok:true, data } / { ok:false, error:'用户可读文案' }。
 *
 * 部署：core/ 与 config 由 tools/sync-api.sh 同步进本目录（core/、miniprogram/config/），
 * 改 core 后必须重跑同步脚本再部署。依赖：wx-server-sdk + exceljs（导出用）。
 */

const { createExportXlsxHandler } = require('./routes-export');
const tencentOcr = require('./tencent-ocr');

// 允许远程调用的 core 模块（业务模块，函数签名均为 (db, actorId, ...)）。
// db/config/models/format/payAdapter/ocr/contentSafety 不开放：
// 分别是基础设施、常量、纯工具与适配层，各有自己的入口。
// export 于 2026-10-23 任务AD 加入：只放行 buildExportData（导出页概览的
// 只读聚合，无写操作、无审计写入）；exportData 含实际导出筛选与审计，
// 仍只经 exportXlsx 专用路由调用，不经通用分发。
const ALLOWED_MODULES = [
  'contacts', 'receive', 'gifts', 'stats', 'share', 'quota', 'inviteReward',
  'payment', 'points', 'admin', 'restriction', 'users', 'account', 'notify',
  'feedback', 'audit', 'importer', 'export', 'features',
];

/** 服务端静默建号（与小程序端 data-service.ensureUser 同口径）：
 * 首次调用时建 users 文档（_id=openid）并发注册赠送积分（幂等，只发一次）。
 * 业务函数普遍假设用户文档已存在（如 quota 按 user._id 计额度），缺了会空指针。 */
async function ensureServerUser(db, core, openid, cache) {
  // 进程内缓存（性能）：同一函数容器内已确认存在的用户跳过这次 DB 读——
  // 热路径上每个业务调用原本都要先读一次 users。只缓存"已存在"这一
  // 事实；账号限制另有 restriction.assertWritable 在写入口独立查，不受影响。
  if (cache && cache.has(openid)) return null;
  const col = db.collection(core.models.COLLECTIONS.User);
  const user = await col.findOne({ _id: openid });
  if (user) { if (cache) cache.add(openid); return user; }
  // 新用户注册总闸（AL-7）：老板平台关掉注册后，新号首次进入被拒；
  // 老用户不受影响，管理员名单内的新号放行（防老板自己被关在门外）。
  {
    const cfgDoc = await db.collection(core.models.COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
    if (cfgDoc && cfgDoc.features && cfgDoc.features.registration === false) {
      const admins = [...(Array.isArray(cfgDoc.adminIds) ? cfgDoc.adminIds : []), ...(Array.isArray(cfgDoc.addedAdminIds) ? cfgDoc.addedAdminIds : [])];
      if (!admins.includes(openid)) {
        const e = new Error('新用户注册暂未开放，敬请期待');
        e.code = 'registration-closed';
        throw e;
      }
    }
  }
  const doc = {
    _id: openid,
    profile: { nickname: '', avatarUrl: '' },
    createdAt: Date.now(),
    membership: { status: 'free', expireAt: null },
  };
  await col.insert(doc);
  if (cache) cache.add(openid);
  try { await core.points.grantRegisterBonus(db, openid, core.config); } catch (e) { /* 赠送失败不拦主流程 */ }
  return doc;
}

/** 依赖注入工厂（本地测试用假 SDK 在进程内跑通全链路；云端用默认导出） */
function createMain({ sdk, core, db, buildXlsx, uploadFile, downloadFile, ocrHttpPost }) {
  const _ensuredUsers = new Set(); // 本容器内已确认建号的用户（见 ensureServerUser）
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

  // —— 服务端按 fileID 取云存储文件（字体代取与 OCR 取图共用同一条链） ——
  async function downloadCloudFile(fileID) {
    if (typeof downloadFile === 'function') return downloadFile(fileID);
    if (sdk && typeof sdk.downloadFile === 'function') {
      const r = await sdk.downloadFile({ fileID });
      return r && r.fileContent;
    }
    return null;
  }

  /* —— OCR 真实适配器选择（AQ批）：密钥（云函数环境变量）已配置且调用者
   * 是管理员（appConfig 名单口径与支付闸/admin 判定一致）才注入腾讯云
   * 适配器；其余情况返回 null，core 沿用 MockOCR，行为与接入前一致。
   * 公开开放等用户后续发话，本批不放开非管理员。日志只记实现名。 —— */
  async function pickServerOcrAdapter(openid) {
    if (!tencentOcr.isConfigured()) return null;
    const cfgDoc = await db.collection(core.models.COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
    const admins = cfgDoc
      ? [...(Array.isArray(cfgDoc.adminIds) ? cfgDoc.adminIds : []), ...(Array.isArray(cfgDoc.addedAdminIds) ? cfgDoc.addedAdminIds : [])]
      : [];
    if (!admins.includes(openid)) return null;
    return tencentOcr.createAdapter({ httpPost: ocrHttpPost, fetchImage: downloadCloudFile });
  }

  // —— 字体文件服务端代取（AH批）：白名单 TTF（AY批扩至六款）、容器内缓存 base64 ——
  const FONT_FILE_WHITELIST = ['lxgw-wenkai.ttf', 'mashanzheng.ttf', 'longcang.ttf', 'zhimang.ttf', 'cactus.ttf', 'bakudai.ttf', 'zhimang-supp1.ttf', 'zhimang-supp2.ttf', 'zhimang-supp3.ttf', 'zhimang-supp4.ttf', 'zhimang-supp5.ttf', 'zhimang-supp6.ttf', 'zhimang-supp7.ttf', 'zhimang-supp8.ttf', 'zhimang-supp9.ttf', 'zhimang-supp10.ttf', 'zhimang-supp11.ttf', 'zhimang-supp12.ttf', 'lxgw-supp1.ttf', 'lxgw-supp2.ttf', 'lxgw-supp3.ttf', 'lxgw-supp4.ttf', 'lxgw-supp5.ttf', 'lxgw-supp6.ttf', 'lxgw-supp7.ttf', 'lxgw-supp8.ttf', 'lxgw-supp9.ttf', 'lxgw-supp10.ttf', 'lxgw-supp11.ttf', 'lxgw-supp12.ttf']; // AY批：新增三款字体（枝芒行书/古典宋体/莫大毛笔）；BC批：补充字库 6 片；BT批：补充字库改 12 片；BU批：霞鹜补充字库 12 片
  const _fontBase64Cache = new Map();
  async function handleFontFile(event) {
    const fileID = String((event && event.fileID) || '');
    const base = fileID.split('/').pop();
    if (!fileID.startsWith('cloud://') || !fileID.endsWith(`/fonts/${base}`)
      || !FONT_FILE_WHITELIST.includes(base)) {
      return { ok: false, error: '字体文件不合法' };
    }
    if (_fontBase64Cache.has(base)) {
      return { ok: true, data: { base64: _fontBase64Cache.get(base), mime: 'font/ttf' } };
    }
    const content = await downloadCloudFile(fileID);
    if (!content) return { ok: false, error: '云端取字体失败' };
    const b64 = Buffer.from(content).toString('base64');
    _fontBase64Cache.set(base, b64);
    return { ok: true, data: { base64: b64, mime: 'font/ttf' } };
  }

  return async function main(event = {}) {
    // 定时保活触发（config.json 的 timer 触发器）：空转返回，目的只是让
    // 容器保持热乎、减少用户撞上冷启动（真机反馈保存/删除等数秒的主因）。
    if (event && (event.Type === 'timer' || event.TriggerName)) {
      return { ok: true, warm: true };
    }
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
      if (action === 'fontFile') {
        try { return await handleFontFile(event); }
        catch (e) { return { ok: false, error: '云端取字体失败' }; }
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
      // purchasePointsPack 在服务端注入真适配器 WechatVirtualPayAdapter
      // （2026-10-30 真适配器批：Mock 只留本地演示与自动化测试）。
      // 真实通道：服务端建单签名返回 payParams，前端调 wx.requestVirtualPayment，
      // 发货只认平台发货推送。AppKey/AppSecret 只从云函数环境变量读，
      // 绝不写进代码；缺失时适配器抛带码错误（前端显示通用文案）。
      if (modName === 'payment' && (fnName === 'purchase' || fnName === 'purchasePointsPack')) {
        const opts = (args[1] && typeof args[1] === 'object') ? args[1] : {};
        opts.adapter = new core.payAdapter.WechatVirtualPayAdapter();
        // 第一版发布口径总闸（任务AF）：注入云端闸口信息，core/payment
        // 据此在建单前拒绝普通用户（开关关且非管理员）；本地演示不经此路。
        const cfgDoc = await db.collection(core.models.COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
        const staticEnabled = !!(core.config && core.config.payment && core.config.payment.enabled);
        opts.cloudGate = {
          enabled: (cfgDoc && cfgDoc.payment && typeof cfgDoc.payment.enabled === 'boolean') ? cfgDoc.payment.enabled : staticEnabled,
          isAdmin: !!(cfgDoc && [...(Array.isArray(cfgDoc.adminIds) ? cfgDoc.adminIds : []), ...(Array.isArray(cfgDoc.addedAdminIds) ? cfgDoc.addedAdminIds : [])].includes(OPENID)),
        };
        args[1] = opts;
      }
      if (modName === 'importer' && (fnName === 'startImportTask' || fnName === 'writeImport')) {
        // 拍照导入总闸（任务AF）：给最后一个参数（opts 对象）打云端标记，
        // core/import 据此按 features.photoImport 开关拒绝（防绕过页面）
        const last = args[args.length - 1];
        if (last && typeof last === 'object') {
          const next = { ...last, cloudGate: true };
          if (fnName === 'startImportTask') {
            // OCR 选择（AQ批）：服务端注入真实适配器（函数对象只能在
            // 服务端组装，与 payment 注入 MockPayAdapter 同路）；未注入
            // 时 core 走 MockOCR。日志只记实现名，绝不记密钥。
            const adapter = await pickServerOcrAdapter(OPENID);
            if (adapter) next.ocrAdapter = adapter;
            console.log(`[ocr] startImportTask adapter=${adapter ? 'tencent' : 'mock'}`);
          }
          args[args.length - 1] = next;
        }
      }
      await ensureServerUser(db, core, OPENID, _ensuredUsers);
      // 维护模式总闸（AL-7）：开启时非管理员一律停服；管理员不受限，
      // features.getFlags 与 admin.isAdmin 放行（客户端要靠它们判断状态）。
      if (action !== 'features.getFlags' && action !== 'admin.isAdmin') {
        const cfgDoc = await db.collection(core.models.COLLECTIONS.AppConfig).findOne({ _id: 'singleton' });
        const maint = cfgDoc && cfgDoc.features && typeof cfgDoc.features.maintenance === 'boolean'
          ? cfgDoc.features.maintenance
          : !!(core.config && core.config.features && core.config.features.maintenance);
        if (maint) {
          const admins = cfgDoc ? [...(Array.isArray(cfgDoc.adminIds) ? cfgDoc.adminIds : []), ...(Array.isArray(cfgDoc.addedAdminIds) ? cfgDoc.addedAdminIds : [])] : [];
          if (!admins.includes(OPENID)) return { ok: false, error: '系统维护中，请稍后再来', code: 'maintenance' };
        }
      }
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
