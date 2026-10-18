/** 导出 xlsx 生成引擎测试（阶段3）：真文件 + 成员过滤 + 金额两位小数 */
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

test('主人导出：行数、金额两位小数文本、概览数字', async () => {
  const db = await newDB();
  const { owner } = await setup(db);
  const wb = await loadBuf(await buildXlsx(db, owner, owner));

  const wsR = sheet(wb, '收礼');
  assert.eq(wsR.rowCount, 3, '收礼=表头+2条');
  // 日期倒序：2026-10-02 的李四在前
  assert.eq(wsR.getCell('A2').value, '李四的寿宴', '礼薄名称');
  assert.eq(wsR.getCell('B2').value, '大寿', '场合标签名');
  assert.eq(wsR.getCell('C2').value, '李四', '姓名');
  assert.eq(wsR.getCell('D2').value, '200.00', '金额两位小数文本');
  assert.eq(wsR.getCell('E2').value, '微信', '类型');
  assert.eq(wsR.getCell('D3').value, '1000.00', '第二条金额');
  assert.eq(typeof wsR.getCell('D2').value, 'string', '金额是文本不是数值');

  const wsG = sheet(wb, '送礼');
  assert.eq(wsG.rowCount, 3, '送礼=表头+2条');
  assert.eq(wsG.getCell('C2').value, '300.00', '送礼金额（日期倒序，9-02 在前）');
  assert.eq(wsG.getCell('B2').value, '结婚', '送礼场合');

  const wsO = sheet(wb, '概览');
  const v = (cell) => wsO.getCell(cell).value;
  assert.eq(v('B3'), '全部', '导出范围');
  assert.eq(v('B4'), 2, '礼薄数');
  assert.eq(v('B5'), 2, '收礼记录数');
  assert.eq(v('B6'), 2, '送礼记录数');
  assert.eq(v('B7'), 2, '联系人数');
  assert.eq(v('B8'), '1200.00', '收礼总额');
  assert.eq(v('B9'), '800.00', '送礼总额');
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
  assert.eq(wsR.getCell('D2').value, '1000.00', '金额两位小数');

  const wsG = sheet(wb, '送礼');
  assert.eq(wsG.rowCount, 3, 'scope.gifts=true 时送礼全含');

  const wsO = sheet(wb, '概览');
  assert.eq(wsO.getCell('B3').value, '已授权部分', '导出范围标注');
  assert.eq(wsO.getCell('B4').value, 1, '礼薄数只算授权');
  assert.eq(wsO.getCell('B5').value, 1, '收礼记录数只算授权');
  assert.eq(wsO.getCell('B8').value, '1000.00', '收礼总额只算授权');
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
