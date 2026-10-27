/** 拍照导入测试：OCR 适配层（Mock）+ 确认写入 + 额度拦截 + 收礼目标校验 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const errors = require('../core/errors');
const service = require('../miniprogram/services/data-service');

const ocr = core.ocr;
const importer = core.importer;

/* ---------- OCR 适配层 ---------- */

test('MockOCR：送礼返回 3 条，结构为 {name, amountFen, note, raw}', async () => {
  const list = await ocr.recognize('wxfile://fake.jpg', { kind: 'gift' });
  assert(Array.isArray(list) && list.length === 3, '3 条');
  for (const it of list) {
    assert(typeof it.name === 'string' && it.name.length > 0, 'name 非空');
    assert(Number.isInteger(it.amountFen) && it.amountFen > 0, 'amountFen 正整数分');
    assert(typeof it.note === 'string', 'note 字符串');
    assert(typeof it.raw === 'string', 'raw 字符串');
  }
});

test('MockOCR：收礼返回 2 条', async () => {
  const list = await ocr.recognize('wxfile://fake.jpg', { kind: 'receive' });
  assert(Array.isArray(list) && list.length === 2, '2 条');
});

test('OCR：空图片路径抛错；未知厂商抛错；厂商骨架未接入抛错', async () => {
  let n = 0;
  try { await ocr.recognize('', { kind: 'gift' }); } catch (e) { n++; assert(/拍照/.test(e.message), '空路径提示拍照'); }
  try { await ocr.recognize('x.jpg', { provider: 'nope' }); } catch (e) { n++; assert(/未知/.test(e.message), '未知厂商'); }
  try { await ocr.recognize('x.jpg', { provider: 'tencent' }); } catch (e) { n++; assert(/未接入/.test(e.message), '骨架未接入'); }
  assert(n === 3, '三处都抛错');
});

/* ---------- 确认写入 ---------- */

async function setupOwnerWithContact(db) {
  const owner = await h.newUser(db, 'owner1', { status: 'member', expireAt: Date.now() + 86400e3, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  return { owner, contactId: c._id };
}

test('确认写入：送礼假结果正确落库', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const items = await ocr.recognize('wxfile://fake.jpg', { kind: 'gift' });
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: items.map((it) => ({ contactId, amountFen: it.amountFen, note: it.note })),
  });
  assert(r.written === 3 && r.total === 3 && r.rawError === null, '3 条全写');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 3, '库里 3 条');
  assert(list.every((g) => Number.isInteger(g.amount) && g.amount > 0), '金额为分');
});

test('确认写入：收礼写入指定礼薄', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const ev = await core.receive.createEvent(db, owner, owner, { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  const items = await ocr.recognize('wxfile://fake.jpg', { kind: 'receive' });
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'receive',
    eventId: ev._id,
    items: items.map((it) => ({ contactId, amountFen: it.amountFen, note: it.note })),
  });
  assert(r.written === 2 && r.rawError === null, '2 条全写');
  const recs = await core.receive.listRecords(db, owner, owner, ev._id);
  assert(recs.length === 2, '礼薄下 2 条');
});

test('额度满：送礼第 51 条被拦截，旧 50 条未变', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free1', { status: 'free', expireAt: null, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  for (let i = 0; i < 50; i++) {
    await core.gifts.createGift(db, owner, owner, { contactId: c._id, tagId: 'qita', amount: 100, date: '2026-10-01' });
  }
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId: c._id, amountFen: 100 },
      { contactId: c._id, amountFen: 200 },
    ],
  });
  assert(r.written === 0, '一条都没写进去');
  assert(r.rawError && r.rawError.code === 'quota-exceeded:gift', '额度原因码');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 50, '旧 50 条未变');
});

test('额度拦截走卖惨文案：friendly 透出"呜呜"不吞掉', () => {
  const msg = service.friendly(errors.quotaDenied('quota-exceeded:gift'));
  assert(/^呜呜，本小本本/.test(msg), '卖惨文案透出：' + msg);
  assert(/开个会员/.test(msg), '不报剩余数，引导会员');
});

test('收礼未选礼薄：validateTarget 与 writeImport 都拦截', async () => {
  let n = 0;
  try { importer.validateTarget('receive', ''); } catch (e) { n++; assert(/礼薄/.test(e.message), '提示选礼薄'); }
  try { importer.validateTarget('receive', null); } catch (e) { n++; }
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  try {
    await importer.writeImport(db, owner, owner, { kind: 'receive', eventId: '', items: [{ contactId, amountFen: 100 }] });
  } catch (e) { n++; assert(/礼薄/.test(e.message), '写入前拦截'); }
  assert(n === 3, '三处都拦截');
  // 送礼不需要礼薄
  importer.validateTarget('gift', '');
});

test('条目缺亲友：整批不写并定位到该条（原子性，原"逐条停"口径已废）', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId, amountFen: 100 },
      { name: '王二麻', amountFen: 200 }, // 无 contactId
    ],
  });
  assert(r.written === 0 && r.total === 2, '整批不写');
  assert(/快速创建/.test(r.rawError.message), '提示快速创建');
  assert(r.rawError.itemIndex === 1, '定位到第 2 条');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 0, '一条都没落库');
});

/* ---------- 本轮补全：原子性 / 额度联动 / 失败态 / 编辑值 ---------- */

test('批量原子性：一条金额非法，整批不写且定位到该条', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId, amountFen: 100 },
      { contactId, amountFen: 0 }, // 金额非法
      { contactId, amountFen: 300 },
    ],
  });
  assert(r.written === 0 && r.total === 3, '整批不写');
  assert(r.rawError.itemIndex === 1, '定位到第 2 条');
  assert(/金额不正确/.test(r.rawError.message), '金额报错');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 0, '库里一条都没有');
});

test('批量原子性：亲友 id 不存在（已被删），整批不写', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId, amountFen: 100 },
      { contactId: 'not-exist-id', amountFen: 200 },
    ],
  });
  assert(r.written === 0, '整批不写');
  assert(r.rawError.itemIndex === 1, '定位到第 2 条');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 0, '库里一条都没有');
});

test('额度联动：免费用户已用 49 条送礼额度，导入 2 条整批拦截不部分写入', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free2', { status: 'free', expireAt: null, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  for (let i = 0; i < 49; i++) {
    await core.gifts.createGift(db, owner, owner, { contactId: c._id, tagId: 'qita', amount: 100, date: '2026-10-01' });
  }
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId: c._id, amountFen: 100 },
      { contactId: c._id, amountFen: 200 },
    ],
  });
  assert(r.written === 0, '整批拦截，一条不写');
  assert(r.rawError && r.rawError.code === 'quota-exceeded:gift', '额度原因码');
  assert(r.rawError.itemIndex === 1, '定位到第一条放不下的（第 2 条）');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 49, '仍是 49 条，没有部分写入');
});

test('额度联动：收礼礼薄已记 49 条，导入 2 条整批拦截', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free3', { status: 'free', expireAt: null, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  for (let i = 0; i < 49; i++) {
    await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  }
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'receive',
    eventId: ev._id,
    items: [
      { contactId: c._id, amountFen: 100 },
      { contactId: c._id, amountFen: 200 },
    ],
  });
  assert(r.written === 0, '整批拦截');
  assert(r.rawError && /^quota-exceeded:/.test(r.rawError.code), '额度原因码：' + (r.rawError && r.rawError.code));
  const recs = await core.receive.listRecords(db, owner, owner, ev._id);
  assert(recs.length === 49, '仍是 49 条');
});

test('额度联动：额度刚好够（剩 2 导 2）整批成功', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free4', { status: 'free', expireAt: null, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  for (let i = 0; i < 48; i++) {
    await core.gifts.createGift(db, owner, owner, { contactId: c._id, tagId: 'qita', amount: 100, date: '2026-10-01' });
  }
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId: c._id, amountFen: 100 },
      { contactId: c._id, amountFen: 200 },
    ],
  });
  assert(r.written === 2 && r.rawError === null, '2 条全写');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 50, '正好记满 50 条');
});

test('识别失败态：Mock 可控失败抛出大白话错误', async () => {
  let n = 0;
  try { await ocr.recognize('mockfail://blurry.jpg', { kind: 'gift' }); } catch (e) { n++; assert(/没认出来/.test(e.message), '失败文案大白话：' + e.message); }
  try { await ocr.recognize('wxfile://ok.jpg', { kind: 'gift', fail: true }); } catch (e) { n++; }
  assert(n === 2, '两种触发方式都失败');
  // 失败不影响正常识别
  const list = await ocr.recognize('wxfile://ok.jpg', { kind: 'gift' });
  assert(list.length === 3, '正常路径不受影响');
});

test('编辑后写入：收礼的类型/日期/金额/备注等于核对页编辑值', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const ev = await core.receive.createEvent(db, owner, owner, { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  // 模拟用户在核对页把识别值改掉：金额 1000→1234.50、类型默认现金→微信、日期改到 2026-09-30、补备注
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'receive',
    eventId: ev._id,
    items: [{ name: '张三', contactId, amountFen: 123450, type: '微信', date: '2026-09-30', note: '随礼红包' }],
  });
  assert(r.written === 1 && r.rawError === null, '写入成功');
  const recs = await core.receive.listRecords(db, owner, owner, ev._id);
  assert(recs.length === 1, '1 条');
  assert(recs[0].amount === 123450, '金额=编辑值');
  assert(recs[0].type === '微信', '类型=编辑值');
  assert(recs[0].date === '2026-09-30', '日期=编辑值');
  assert(recs[0].remark === '随礼红包', '备注=编辑值');
});

test('编辑后写入：送礼的场合/日期等于核对页编辑值，缺省类型仍为现金（收礼）', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [{ contactId, amountFen: 50000, tagId: 'jiehun', date: '2026-08-08', note: '' }],
  });
  assert(r.written === 1, '写入成功');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list[0].tagId === 'jiehun', '场合=编辑值');
  assert(list[0].date === '2026-08-08', '日期=编辑值');
  // 收礼不传 type 时缺省现金（与旧行为一致）
  const ev = await core.receive.createEvent(db, owner, owner, { name: '满月酒', tagId: 'manyue', date: '2026-10-02' });
  const r2 = await importer.writeImport(db, owner, owner, {
    kind: 'receive', eventId: ev._id,
    items: [{ contactId, amountFen: 100 }],
  });
  assert(r2.written === 1, '收礼写入成功');
  const recs = await core.receive.listRecords(db, owner, owner, ev._id);
  assert(recs[0].type === '现金', '缺省类型为现金');
});

test('识别顺序契约（任务AE）：适配层不重排、不丢弃空值条目', async () => {
  const ocr = require('../core/ocr-adapter');
  const items = await ocr.recognize('/tmp/any.jpg', { kind: 'gift' });
  assert.eq(items.map((i) => i.name).join(','), '张三,李五,王二麻', 'Mock 列表按返回原序透传（左列先行的顺序契约落在适配层口径上）');
  // 归一化规则：name 空/amount 缺失的条目保留为空值条目（核对页靠空行补录），不得过滤
  const kept = await ocr.MockOCR.recognize('/tmp/any.jpg', { kind: 'receive' });
  assert.eq(kept.length, 2, '收礼 Mock 条数');
  const norm = items.every((i) => typeof i.name === 'string' && (i.amountFen === null || Number.isInteger(i.amountFen)));
  assert(norm, '归一化后每条都有 name 字段、amountFen 为整数分或 null');
});
