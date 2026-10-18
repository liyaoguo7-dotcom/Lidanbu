/** 导出 xlsx 生成引擎测试（阶段3）：真文件 + 成员过滤 + 金额数值型 */
const { test, assert } = require('./fw');
const ExcelJS = require('exceljs');
const core = require('../core');
const { buildXlsx } = require('../core/export-xlsx');
const { newDB, newUser, setupMember } = require('./helpers');

async function setup(db) {
  const owner = await newUser(db, 'owner1', {
    status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null,
  });
  const c1 = await core.contacts.createContact(db, owner, owner, { name: '张三', remark: '同学' });
  const c2 = await core.contacts.createContact(db, owner, owner, { name: '李四' });
  const evA = await core.receive.createEvent(db, owner, owner, { name: '张三的婚宴', tagId: 'jiehun', date: '2026-10-01' });
  const evB = await core.receive.createEvent(db, owner, owner, { name: '李四的寿宴', tagId: 'dashou', date: '2026-10-02' });
  await core.receive.createRecord(db, owner, owner, evA._id, { contactId: c1._id, amount: 100000, type: '现金', date: '2026-10-01' });
  await core.receive.createRecord(db, owner, owner, evB._id, { contactId: c2._id, amount: 20000, type: '微信', date: '2026-10-02' });
  await core.gifts.createGift(db, owner, owner, { contactId: c1._id, tagId: 'shengri', amount: 50000, date: '2026-09-01' });
  await core.gifts.createGift(db, owner, owner, { contactId: c2._id, tagId: 'jiehun', amount: 30000, date: '2026-09-02' });
  return { owner, evA: evA._id, evB: evB._id };
}

async function loadBuf(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

function sheet(wb, name) {
  const ws = wb.getWorksheet(name);
  assert(ws, `sheet「${name}」存在`);
  return ws;
}

test('主人导出：Buffer 非空、PK 头、3 个 sheet', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  const buf = await buildXlsx(db, owner, owner);
  assert(Buffer.isBuffer(buf), '返回 Buffer');
  assert(buf.length > 0, '非空');
  assert(buf[0] === 0x50 && buf[1] === 0x4b, 'zip 魔数 PK');
  const wb = await loadBuf(buf);
  const names = wb.worksheets.map((w) => w.name);
  assert.eq(names.join(','), '收礼,送礼,概览', 'sheet 名与顺序');
});

test('主人导出：行数、金额数值型 + 0.00 格式、概览数字', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  const wb = await loadBuf(await buildXlsx(db, owner, owner));

  const wsR = sheet(wb, '收礼');
  assert.eq(wsR.rowCount, 3, '收礼=表头+2条');
  // 日期倒序：2026-10-02 的李四在前
  assert.eq(wsR.getCell('A2').value, '李四的寿宴', '礼薄名称');
  assert.eq(wsR.getCell('B2').value, '大寿', '场合标签名');
  assert.eq(wsR.getCell('C2').value, '李四', '姓名');
  const d2 = wsR.getCell('D2');
  assert.eq(typeof d2.value, 'number', '金额是数值型不是文本');
  assert.eq(d2.value, 200, '金额值=20000分/100');
  assert.eq(d2.numFmt, '0.00', '数字格式 0.00');
  assert.eq(wsR.getCell('E2').value, '微信', '类型');
  const d3 = wsR.getCell('D3');
  assert.eq(d3.value, 1000, '第二条金额');
  assert.eq(d3.numFmt, '0.00', '数字格式');

  const wsG = sheet(wb, '送礼');
  assert.eq(wsG.rowCount, 3, '送礼=表头+2条');
  const g2 = wsG.getCell('C2');
  assert.eq(typeof g2.value, 'number', '送礼金额数值型');
  assert.eq(g2.value, 300, '送礼金额（日期倒序，9-02 在前）');
  assert.eq(g2.numFmt, '0.00', '数字格式');
  assert.eq(wsG.getCell('B2').value, '结婚', '送礼场合');

  const wsO = sheet(wb, '概览');
  const v = (cell) => wsO.getCell(cell).value;
  assert.eq(v('B3'), '全部', '导出范围');
  assert.eq(v('B4'), 2, '礼薄数');
  assert.eq(v('B5'), 2, '收礼记录数');
  assert.eq(v('B6'), 2, '送礼记录数');
  assert.eq(v('B7'), 2, '联系人数');
  assert.eq(v('B8'), 1200, '收礼总额=120000分/100');
  assert.eq(wsO.getCell('B8').numFmt, '0.00', '总额数字格式');
  assert.eq(v('B9'), 800, '送礼总额');
  assert.eq(wsO.getCell('B9').numFmt, '0.00', '总额数字格式');
});

test('金额列：SUM 公式可求和、无浮点误差（100005分→1000.05）', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  // 加一条 100005 分的记录，专测浮点敏感值
  const c = await core.contacts.createContact(db, owner, owner, { name: '王五' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '王五的满月宴', tagId: 'shengzi', date: '2026-10-03' });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100005, type: '现金', date: '2026-10-03' });

  const wb = await loadBuf(await buildXlsx(db, owner, owner));
  const wsR = sheet(wb, '收礼');
  // 日期倒序：10-03 的王五在最前（第 2 行）
  const d2 = wsR.getCell('D2');
  assert.eq(typeof d2.value, 'number', '数值型');
  assert.eq(d2.numFmt, '0.00', '数字格式');
  assert(d2.value === 100005 / 100, `值与存储的分一致（实际${d2.value}）`);
  assert(d2.value === 1000.05, '无浮点误差：100005分 → 1000.05');

  // 在工作表内对金额列写 SUM 公式：公式落盘后重读，断言存在且引用范围正确
  const last = wsR.rowCount; // 表头+3条=4
  const range = `D2:D${last}`;
  wsR.getCell('H2').value = { formula: `SUM(${range})` };
  const buf2 = await wb.xlsx.writeBuffer();
  const wb2 = await loadBuf(Buffer.isBuffer(buf2) ? buf2 : Buffer.from(buf2));
  const f = wb2.getWorksheet('收礼').getCell('H2').value;
  assert(f && f.formula === `SUM(${range})`, 'SUM 公式存在且引用金额列全范围');

  // 值校验：按列求和，与按分累加的期望一致
  let sum = 0;
  const wsR2 = wb2.getWorksheet('收礼');
  for (let r = 2; r <= last; r++) sum += wsR2.getCell(`D${r}`).value;
  assert(sum === (100005 + 20000 + 100000) / 100, '列内求和值正确');
});

test('成员无 export 开关：被拒绝', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const { member } = await setupMember(db, owner, { events: [evA], gifts: true, switches: { view: true } });
  let err = null;
  try {
    await buildXlsx(db, member, owner);
  } catch (e) { err = e; }
  assert(err, '抛错');
  assert.eq(err.code, 'switch-off:export', '原因码');
});

test('成员有 export 开关：只能导出授权事件，概览只算授权部分', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const { member } = await setupMember(db, owner, {
    events: [evA], gifts: true, switches: { view: true, export: true },
  });
  const wb = await loadBuf(await buildXlsx(db, member, owner));

  const wsR = sheet(wb, '收礼');
  assert.eq(wsR.rowCount, 2, '只含授权事件的1条收礼');
  assert.eq(wsR.getCell('A2').value, '张三的婚宴', '未授权的寿宴不在文件里');
  const d2 = wsR.getCell('D2');
  assert.eq(d2.value, 1000, '金额数值');
  assert.eq(d2.numFmt, '0.00', '数字格式');

  const wsG = sheet(wb, '送礼');
  assert.eq(wsG.rowCount, 3, 'scope.gifts=true 时送礼全含');

  const wsO = sheet(wb, '概览');
  assert.eq(wsO.getCell('B3').value, '已授权部分', '导出范围标注');
  assert.eq(wsO.getCell('B4').value, 1, '礼薄数只算授权');
  assert.eq(wsO.getCell('B5').value, 1, '收礼记录数只算授权');
  assert.eq(wsO.getCell('B8').value, 1000, '收礼总额只算授权');
  assert.eq(wsO.getCell('B8').numFmt, '0.00', '总额数字格式');
});

test('成员 scope.gifts=false：送礼 sheet 只有表头', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const { member } = await setupMember(db, owner, {
    events: [evA], gifts: false, switches: { view: true, export: true },
  });
  const wb = await loadBuf(await buildXlsx(db, member, owner));
  assert.eq(sheet(wb, '送礼').rowCount, 1, '无送礼数据行');
  assert.eq(sheet(wb, '概览').getCell('B6').value, 0, '送礼记录数=0');
});

test('主人可按 eventIds 过滤礼薄', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const wb = await loadBuf(await buildXlsx(db, owner, owner, { eventIds: [evA] }));
  assert.eq(sheet(wb, '收礼').rowCount, 2, '只导出指定礼薄');
  assert.eq(sheet(wb, '收礼').getCell('A2').value, '张三的婚宴', '礼薄对');
});
