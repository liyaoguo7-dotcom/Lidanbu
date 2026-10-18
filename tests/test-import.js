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

test('额度满：送礼第 31 条被拦截，旧 30 条未变', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'free1', { status: 'free', expireAt: null, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  for (let i = 0; i < 30; i++) {
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
  assert(list.length === 30, '旧 30 条未变');
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

test('条目缺亲友：停在该条并给出"先建亲友"提示', async () => {
  const db = await h.newDB();
  const { owner, contactId } = await setupOwnerWithContact(db);
  const r = await importer.writeImport(db, owner, owner, {
    kind: 'gift',
    items: [
      { contactId, amountFen: 100 },
      { name: '王二麻', amountFen: 200 }, // 无 contactId
    ],
  });
  assert(r.written === 1 && r.total === 2, '首条写了，第二条停');
  assert(/先建亲友/.test(r.rawError.message), '提示先建亲友');
  const list = await core.gifts.listGifts(db, owner, owner);
  assert(list.length === 1, '只落库 1 条');
});
