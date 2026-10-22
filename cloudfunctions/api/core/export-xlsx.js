/**
 * 礼单簿 · 导出 .xlsx 生成引擎（阶段3）
 *
 * 运行环境：Node（本地测试）与微信云函数。绝不在小程序端运行——
 * exceljs 为 Node 专用库且体积大；小程序端阶段3"导出备份"界面通过
 * 云函数（wx.cloud.callFunction）调用本模块生成文件，本次不做界面。
 *
 * 注意：不要把本模块加入 core/index.js 的导出（小程序打包目录
 * miniprogram/core/ 由 tools/sync-core.sh 同步，本模块已被排除在同步之外）。
 *
 * 权限：复用 export.exportData——内部调 checkExportScope 定范围，
 * 成员无 export 开关直接抛"无权限"（switch-off:export），只能导出
 * 已授权事件的记录；联系人只取导出记录里出现过的（成员视角自动
 * 只含授权部分）。
 *
 * 金额规则（总指挥第三轮指令）：
 * - 金额列写数值单元格：cell.value = 分/100（单次换算），
 *   cell.numFmt = '0.00'；用户在 Excel 里可直接 SUM，显示为 1000.00。
 * - 求和（每张表的表尾合计行）在服务端用整数分累加，换算（/100）
 *   只做一次，不经过浮点累加。
 *
 * 分组铁律（2026-10-22 任务Z 第 14 项，用户明确要求）：不管勾选范围大小，
 * 永远只生成一个 .xlsx；内部分组用多个工作表——送礼一个表（表名「送礼记录」），
 * 每个收礼礼薄一个表（表名「礼薄名（收礼）」）；每张表保留既有列结构，
 * 表尾带合计行（合计金额 + 共 X 笔）。
 */

const ExcelJS = require('exceljs');
const { exportData } = require('./export');
const { COLLECTIONS } = require('./models');

/** tagId → 标签名；取不到配置时回退为 tagId 本身 */
function tagNameOf(tagId) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const cfg = require('../miniprogram/config/app-config');
    const t = (cfg.tags || []).find((x) => x.id === tagId);
    return t ? t.name : tagId;
  } catch (e) {
    return tagId;
  }
}

/** 本地时间 "YYYY-MM-DD HH:mm"（不用 toLocaleString，避开金额扫描误报） */
function fmtDateTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function boldHeader(ws) {
  ws.getRow(1).font = { bold: true };
}

/** 工作表名清洗：Excel 禁用字符 \ / ? * [ ] : 替换为「·」，最长 31 字 */
function cleanSheetBase(name) {
  const s = String(name || '').replace(/[\\/?*[\]:]/g, '·').trim();
  return s || '礼薄';
}

/** 生成不重复的工作表名（同名礼薄依次加 -2、-3 后缀），并登记到 used 集合 */
function uniqueSheetName(base, used) {
  let candidate = base.slice(0, 31);
  let i = 2;
  while (used.has(candidate)) {
    const suffix = `-${i}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * 表尾合计行（任务Z 第 14 项）：首列写「合计」，金额列写整数分累加后
 * 一次换算的数值（0.00 格式），末列（备注）写「共 X 笔」；整行加粗。
 * @param {object} ws 已设好 columns 的 worksheet
 * @param {Array} rowsFen 本表各行金额（整数分）
 */
function addTotalRow(ws, rowsFen) {
  const totalFen = rowsFen.reduce((s, v) => s + (Number(v) || 0), 0);
  const row = ws.addRow({});
  const firstKey = ws.columns[0] && ws.columns[0].key;
  const lastKey = ws.columns[ws.columns.length - 1] && ws.columns[ws.columns.length - 1].key;
  if (firstKey) row.getCell(firstKey).value = '合计';
  const amtCell = row.getCell('amount');
  amtCell.value = toYuan(totalFen);
  amtCell.numFmt = '0.00';
  if (lastKey && lastKey !== 'amount') row.getCell(lastKey).value = `共 ${rowsFen.length} 笔`;
  row.font = { bold: true };
  return row;
}

/**
 * 分 → 元：单次换算（/100 只做一次）。非法输入按 0 处理，不写 NaN 进表格。
 * 注意：不要在这里或调用处做浮点累加；求和一律先在整数分上累加。
 */
function toYuan(fen) {
  const n = Number(fen);
  return Number.isFinite(n) ? n / 100 : 0;
}

/**
 * 把某数据行的金额列设为数值型 + 数字格式 0.00。
 * 按列 key 'amount' 定位，不写死列号。
 */
function markAmountCell(ws, row) {
  const col = ws.columns.findIndex((c) => c.key === 'amount') + 1;
  if (col > 0) row.getCell(col).numFmt = '0.00';
}

/**
 * 生成导出 .xlsx
 * @param {object} db MemoryDB / CloudDB
 * @param {string} actorId 导出者 openid
 * @param {string} ownerId 账本主人 openid
 * @param {object} opts {eventIds?: string[]|null, includeGifts?: boolean}
 * @returns {Promise<Buffer>} xlsx 文件二进制
 * @throws 无权限导出（成员未开 export 开关等）
 */
async function buildXlsx(db, actorId, ownerId, opts = {}) {
  // exportData 内部：checkExportScope 定范围 → 取事件/收礼/送礼 → 写审计
  const { events, records, gifts } = await exportData(db, actorId, ownerId, opts);

  // 联系人只取导出记录里出现过的（成员自动只含授权部分）
  const contactIds = new Set();
  records.forEach((r) => { if (r.contactId) contactIds.add(r.contactId); });
  gifts.forEach((g) => { if (g.contactId) contactIds.add(g.contactId); });
  const contacts = contactIds.size
    ? await db.collection(COLLECTIONS.Contact).find({ _id: { $in: [...contactIds] }, ownerId })
    : [];
  const nameOf = {};
  contacts.forEach((c) => { nameOf[c._id] = c.name; });

  const eventById = {};
  events.forEach((e) => { eventById[e._id] = e; });

  const wb = new ExcelJS.Workbook();
  wb.creator = '礼单簿';
  wb.created = new Date();

  const usedNames = new Set();
  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

  // —— 送礼一个表（表名「送礼记录」；日期从新到旧，与产品列表"最新在上"一致）——
  if (opts.includeGifts !== false) {
    const wsG = wb.addWorksheet(uniqueSheetName('送礼记录', usedNames));
    wsG.columns = [
      { header: '姓名', key: 'name', width: 12 },
      { header: '场合', key: 'tag', width: 10 },
      { header: '金额（元）', key: 'amount', width: 14 },
      { header: '日期', key: 'date', width: 14 },
      { header: '备注', key: 'remark', width: 24 },
    ];
    [...gifts].sort(byDateDesc).forEach((g) => {
      const row = wsG.addRow({
        name: nameOf[g.contactId] || '',
        tag: tagNameOf(g.tagId),
        amount: toYuan(g.amount),
        date: g.date || '',
        remark: g.remark || '',
      });
      markAmountCell(wsG, row);
    });
    boldHeader(wsG);
    addTotalRow(wsG, gifts.map((g) => g.amount));
  }

  // —— 每个收礼礼薄一个表（表名「礼薄名（收礼）」），列结构与原「收礼」表一致 ——
  const recordsByEvent = {};
  records.forEach((r) => {
    if (!recordsByEvent[r.eventId]) recordsByEvent[r.eventId] = [];
    recordsByEvent[r.eventId].push(r);
  });
  events.forEach((ev) => {
    const wsR = wb.addWorksheet(uniqueSheetName(`${cleanSheetBase(ev.name)}（收礼）`, usedNames));
    wsR.columns = [
      { header: '礼薄名称', key: 'eventName', width: 20 },
      { header: '场合', key: 'tag', width: 10 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '金额（元）', key: 'amount', width: 14 },
      { header: '类型', key: 'type', width: 10 },
      { header: '日期', key: 'date', width: 14 },
      { header: '备注', key: 'remark', width: 24 },
    ];
    const rows = [...(recordsByEvent[ev._id] || [])].sort(byDateDesc);
    rows.forEach((r) => {
      const row = wsR.addRow({
        eventName: ev.name || '',
        tag: tagNameOf(ev.tagId),
        name: nameOf[r.contactId] || '',
        amount: toYuan(r.amount),
        type: r.type || '',
        date: r.date || '',
        remark: r.remark || '',
      });
      markAmountCell(wsR, row);
    });
    boldHeader(wsR);
    addTotalRow(wsR, rows.map((r) => r.amount));
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = { buildXlsx };
