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
 * - 求和类数字（概览 sheet 的收礼总额/送礼总额）在服务端用整数分
 *   累加，换算（/100）只做一次，不经过浮点累加。
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

  // —— 收礼 sheet（日期从新到旧，与产品列表"最新在上"一致）——
  const wsR = wb.addWorksheet('收礼');
  wsR.columns = [
    { header: '礼薄名称', key: 'eventName', width: 20 },
    { header: '场合', key: 'tag', width: 10 },
    { header: '姓名', key: 'name', width: 12 },
    { header: '金额（元）', key: 'amount', width: 14 },
    { header: '类型', key: 'type', width: 10 },
    { header: '日期', key: 'date', width: 14 },
    { header: '备注', key: 'remark', width: 24 },
  ];
  [...records]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .forEach((r) => {
      const ev = eventById[r.eventId] || {};
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

  // —— 送礼 sheet ——
  const wsG = wb.addWorksheet('送礼');
  wsG.columns = [
    { header: '姓名', key: 'name', width: 12 },
    { header: '场合', key: 'tag', width: 10 },
    { header: '金额（元）', key: 'amount', width: 14 },
    { header: '日期', key: 'date', width: 14 },
    { header: '备注', key: 'remark', width: 24 },
  ];
  [...gifts]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .forEach((g) => {
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

  // —— 概览 sheet（当前账本数据情况；成员只看已授权部分）——
  const wsO = wb.addWorksheet('概览');
  wsO.columns = [
    { header: '项目', key: 'k', width: 22 },
    { header: '数值', key: 'v', width: 30 },
  ];
  // 总额在整数分上累加（全程整数运算，无浮点误差），换算（/100）只做一次
  const totalReceiveFen = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalGiftFen = gifts.reduce((s, g) => s + (Number(g.amount) || 0), 0);
  [
    ['导出时间', fmtDateTime(Date.now()), false],
    ['导出范围', actorId === ownerId ? '全部' : '已授权部分', false],
    ['礼薄数', events.length, false],
    ['收礼记录数', records.length, false],
    ['送礼记录数', gifts.length, false],
    ['联系人数（导出范围内）', contactIds.size, false],
    ['收礼总额（元）', toYuan(totalReceiveFen), true],
    ['送礼总额（元）', toYuan(totalGiftFen), true],
  ].forEach(([k, v, isAmount]) => {
    const row = wsO.addRow({ k, v });
    if (isAmount) row.getCell(2).numFmt = '0.00';
  });
  boldHeader(wsO);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = { buildXlsx };
