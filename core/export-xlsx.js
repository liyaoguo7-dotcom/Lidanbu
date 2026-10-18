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
 * 金额铁律：所有金额单元格调 format.formatAmount 得到两位小数文本
 * （如 "1000.00"），不用数值型避免浮点误差。
 */

const ExcelJS = require('exceljs');
const { exportData } = require('./export');
const { COLLECTIONS } = require('./models');
const { formatAmount } = require('./format');

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
      wsR.addRow({
        eventName: ev.name || '',
        tag: tagNameOf(ev.tagId),
        name: nameOf[r.contactId] || '',
        amount: formatAmount(r.amount),
        type: r.type || '',
        date: r.date || '',
        remark: r.remark || '',
      });
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
      wsG.addRow({
        name: nameOf[g.contactId] || '',
        tag: tagNameOf(g.tagId),
        amount: formatAmount(g.amount),
        date: g.date || '',
        remark: g.remark || '',
      });
    });
  boldHeader(wsG);

  // —— 概览 sheet（当前账本数据情况；成员只看已授权部分）——
  const wsO = wb.addWorksheet('概览');
  wsO.columns = [
    { header: '项目', key: 'k', width: 22 },
    { header: '数值', key: 'v', width: 30 },
  ];
  const totalReceive = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalGift = gifts.reduce((s, g) => s + (Number(g.amount) || 0), 0);
  [
    ['导出时间', fmtDateTime(Date.now())],
    ['导出范围', actorId === ownerId ? '全部' : '已授权部分'],
    ['礼薄数', events.length],
    ['收礼记录数', records.length],
    ['送礼记录数', gifts.length],
    ['联系人数（导出范围内）', contactIds.size],
    ['收礼总额（元）', formatAmount(totalReceive)],
    ['送礼总额（元）', formatAmount(totalGift)],
  ].forEach(([k, v]) => wsO.addRow({ k, v }));
  boldHeader(wsO);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = { buildXlsx };
