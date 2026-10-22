/** 导出 xlsx 生成引擎测试（阶段3；2026-10-22 任务Z 第 14 项按新分组口径重写）：
 * 分组铁律——永远一个文件；送礼一个表「送礼记录」，每个收礼礼薄一个表
 * 「礼薄名（收礼）」；每表保留既有列结构 + 表尾合计行（合计金额 + 共 X 笔）；
 * 金额数值单元格 0.00 格式、整数分累加一次换算。 */
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

test('主人导出：一个文件、多张表（送礼记录 + 每礼薄一表），表名断言', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  const buf = await buildXlsx(db, owner, owner);
  assert(Buffer.isBuffer(buf), '返回 Buffer');
  assert(buf.length > 0, '非空');
  assert(buf[0] === 0x50 && buf[1] === 0x4b, 'zip 魔数 PK');
  const wb = await loadBuf(buf);
  const names = wb.worksheets.map((w) => w.name);
  assert.eq(names.join(','), '送礼记录,张三的婚宴（收礼）,李四的寿宴（收礼）', 'sheet 名与顺序（单文件多表）');
  assert(!wb.getWorksheet('概览'), '旧的概览表已取消（合计改到各表表尾）');
  assert(!wb.getWorksheet('收礼') && !wb.getWorksheet('送礼'), '旧的合并表已取消');
});

test('主人导出：送礼表列结构/金额数值型/合计行；礼薄表按本合计', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  const wb = await loadBuf(await buildXlsx(db, owner, owner));

  // —— 送礼记录：表头 + 2 条 + 合计行 ——
  const wsG = sheet(wb, '送礼记录');
  assert.eq(wsG.rowCount, 4, '送礼=表头+2条+合计行');
  const g2 = wsG.getCell('C2');
  assert.eq(typeof g2.value, 'number', '送礼金额数值型');
  assert.eq(g2.value, 300, '送礼金额（日期倒序，9-02 在前）');
  assert.eq(g2.numFmt, '0.00', '数字格式');
  assert.eq(wsG.getCell('B2').value, '结婚', '送礼场合');
  assert.eq(wsG.getCell('A4').value, '合计', '合计行首列');
  const gTotal = wsG.getCell('C4');
  assert.eq(gTotal.value, 800, '送礼合计=（50000+30000）分/100');
  assert.eq(gTotal.numFmt, '0.00', '合计数字格式');
  assert.eq(wsG.getCell('E4').value, '共 2 笔', '合计行笔数');

  // —— 礼薄表：列结构保留（含礼薄名称列）、只含本薄记录、表尾合计 ——
  const wsA = sheet(wb, '张三的婚宴（收礼）');
  assert.eq(wsA.rowCount, 3, '婚宴=表头+1条+合计行');
  assert.eq(wsA.getCell('A2').value, '张三的婚宴', '礼薄名称');
  assert.eq(wsA.getCell('B2').value, '结婚', '场合标签名');
  assert.eq(wsA.getCell('C2').value, '张三', '姓名');
  const d2 = wsA.getCell('D2');
  assert.eq(typeof d2.value, 'number', '金额是数值型不是文本');
  assert.eq(d2.value, 1000, '金额值=100000分/100');
  assert.eq(d2.numFmt, '0.00', '数字格式 0.00');
  assert.eq(wsA.getCell('E2').value, '现金', '类型');
  assert.eq(wsA.getCell('A3').value, '合计', '合计行首列');
  assert.eq(wsA.getCell('D3').value, 1000, '本薄合计');
  assert.eq(wsA.getCell('D3').numFmt, '0.00', '合计数字格式');
  assert.eq(wsA.getCell('G3').value, '共 1 笔', '合计行笔数');

  const wsB = sheet(wb, '李四的寿宴（收礼）');
  assert.eq(wsB.rowCount, 3, '寿宴=表头+1条+合计行');
  assert.eq(wsB.getCell('C2').value, '李四', '姓名');
  assert.eq(wsB.getCell('D2').value, 200, '金额');
  assert.eq(wsB.getCell('D3').value, 200, '本薄合计');
});

test('金额列：数值可求和、无浮点误差（100005分→1000.05），合计行整数分累加', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  const c = await core.contacts.createContact(db, owner, owner, { name: '王五' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '王五的满月宴', tagId: 'shengzi', date: '2026-10-03' });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100005, type: '现金', date: '2026-10-03' });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 5, type: '现金', date: '2026-10-04' });

  const wb = await loadBuf(await buildXlsx(db, owner, owner));
  const wsR = sheet(wb, '王五的满月宴（收礼）');
  // 日期倒序：10-04（5分）在第 2 行，10-03（100005分）在第 3 行
  const d3 = wsR.getCell('D3');
  assert.eq(typeof d3.value, 'number', '数值型');
  assert.eq(d3.numFmt, '0.00', '数字格式');
  assert(d3.value === 100005 / 100, `值与存储的分一致（实际${d3.value}）`);
  assert(d3.value === 1000.05, '无浮点误差：100005分 → 1000.05');
  // 合计行（第 4 行）=（100005+5）分一次换算
  assert.eq(wsR.getCell('D4').value, (100005 + 5) / 100, '合计=整数分累加后一次换算');
  assert.eq(wsR.getCell('G4').value, '共 2 笔', '笔数');

  // SUM 公式落盘重读：引用数据行范围（不含合计行）
  wsR.getCell('H2').value = { formula: 'SUM(D2:D3)' };
  const buf2 = await wb.xlsx.writeBuffer();
  const wb2 = await loadBuf(Buffer.isBuffer(buf2) ? buf2 : Buffer.from(buf2));
  const f = wb2.getWorksheet('王五的满月宴（收礼）').getCell('H2').value;
  assert(f && f.formula === 'SUM(D2:D3)', 'SUM 公式存在且引用金额列数据范围');
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

test('成员有 export 开关：只能导出授权礼薄，表与合计只算授权部分', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const { member } = await setupMember(db, owner, {
    events: [evA], gifts: true, switches: { view: true, export: true },
  });
  const wb = await loadBuf(await buildXlsx(db, member, owner));
  const names = wb.worksheets.map((w) => w.name);
  assert.eq(names.join(','), '送礼记录,张三的婚宴（收礼）', '未授权的寿宴不生成表');
  const wsA = sheet(wb, '张三的婚宴（收礼）');
  assert.eq(wsA.rowCount, 3, '只含授权事件的1条收礼+合计行');
  assert.eq(wsA.getCell('D2').value, 1000, '金额数值');
  assert.eq(wsA.getCell('D3').value, 1000, '合计只算授权部分');
  const wsG = sheet(wb, '送礼记录');
  assert.eq(wsG.rowCount, 4, 'scope.gifts=true 时送礼全含（表头+2条+合计）');
  assert.eq(wsG.getCell('C4').value, 800, '送礼合计');
});

test('成员 scope.gifts=false：送礼表无数据行（合计 0 笔）', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const { member } = await setupMember(db, owner, {
    events: [evA], gifts: false, switches: { view: true, export: true },
  });
  const wb = await loadBuf(await buildXlsx(db, member, owner, { includeGifts: false }));
  assert(!wb.getWorksheet('送礼记录'), 'includeGifts=false 时不生成送礼表');
  const wb2 = await loadBuf(await buildXlsx(db, member, owner));
  const wsG = sheet(wb2, '送礼记录');
  assert.eq(wsG.rowCount, 2, '表头+合计行，无数据行');
  assert.eq(wsG.getCell('C2').value, 0, '合计金额为 0');
  assert.eq(wsG.getCell('E2').value, '共 0 笔', '合计笔数为 0');
});

test('主人可按 eventIds 过滤礼薄；只勾送礼时只有一个表', async () => {
  const db = await newDB();
  const { owner, evA } = await setup(db);
  const wb = await loadBuf(await buildXlsx(db, owner, owner, { eventIds: [evA] }));
  const names = wb.worksheets.map((w) => w.name);
  assert.eq(names.join(','), '送礼记录,张三的婚宴（收礼）', '只导出指定礼薄');
  assert.eq(sheet(wb, '张三的婚宴（收礼）').rowCount, 3, '表头+1条+合计行');

  const wb2 = await loadBuf(await buildXlsx(db, owner, owner, { eventIds: [] }));
  assert.eq(wb2.worksheets.length, 1, '不勾任何礼薄时只剩送礼一个表');
  assert.eq(wb2.worksheets[0].name, '送礼记录', '唯一的表是送礼记录');
});

test('礼薄名含 Excel 禁用字符或同名：表名清洗且不重复', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  // 账本内礼薄名本身不许重名；这里用清洗后同名的两个不同原名测表名去重
  const ev1 = await core.receive.createEvent(db, owner, owner, { name: '张/三:婚礼?', tagId: 'jiehun', date: '2026-10-05' });
  const ev2 = await core.receive.createEvent(db, owner, owner, { name: '张?三/婚礼*', tagId: 'jiehun', date: '2026-10-06' });
  assert(ev1._id !== ev2._id, '两个清洗后同名的礼薄');
  const wb = await loadBuf(await buildXlsx(db, owner, owner, { eventIds: [ev1._id, ev2._id], includeGifts: false }));
  const names = wb.worksheets.map((w) => w.name);
  assert.eq(names.length, 2, '两个礼薄两张表');
  assert(names.every((n) => !/[\\/?*[\]:]/.test(n)), '表名不含禁用字符');
  assert(names[0] !== names[1], '同名礼薄表名不重复');
  assert(names.every((n) => n.length <= 31), '表名不超过 31 字');
});
