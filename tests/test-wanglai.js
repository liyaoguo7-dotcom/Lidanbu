/** 2B 往来数据层测试：统计/竖线树/时间筛选/成员视角/姓名搜索（纯数据层，不碰界面） */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

const stats = core.stats;

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n) {
  return fmt(new Date(Date.now() - n * 86400e3));
}
const TODAY = fmt(new Date());
const MONTH_START = TODAY.slice(0, 7) + '-01';
const YEAR_START = TODAY.slice(0, 4) + '-01-01';
function dayBefore(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return fmt(new Date(y, m - 1, d - 1));
}
const PREV_MONTH_END = dayBefore(MONTH_START);
const PREV_YEAR_END = dayBefore(YEAR_START);
const D400 = daysAgo(400);
const IS_JAN = new Date().getMonth() === 0;

/** 建账本：cA 收/送混合；cR 专供时间筛选（6 条送礼，金额各异）；cB/cC 供成员视角 */
async function setup(db) {
  const owner = await h.newUser(db, 'owner1', { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
  const cA = await core.contacts.createContact(db, owner, owner, { name: '张三', remark: '同学' });
  const cB = await core.contacts.createContact(db, owner, owner, { name: '张小三' });
  const cC = await core.contacts.createContact(db, owner, owner, { name: '李四' });
  const cR = await core.contacts.createContact(db, owner, owner, { name: '王五' });
  const evA = await core.receive.createEvent(db, owner, owner, { name: '张三的婚宴', tagId: 'jiehun', date: TODAY });
  const evB = await core.receive.createEvent(db, owner, owner, { name: '李四的满月酒', tagId: 'shengzi', date: TODAY });
  const evOld = await core.receive.createEvent(db, owner, owner, { name: '旧礼薄', tagId: 'qita', date: D400 });
  // cA：收礼 100000(今) + 20000(400天前)；送礼 30000(今) + 150000(2天前)
  await core.receive.createRecord(db, owner, owner, evA._id, { contactId: cA._id, amount: 100000, type: '现金', date: TODAY });
  await core.receive.createRecord(db, owner, owner, evOld._id, { contactId: cA._id, amount: 20000, type: '红包', date: D400 });
  await core.gifts.createGift(db, owner, owner, { contactId: cA._id, tagId: 'shengri', amount: 30000, date: TODAY });
  await core.gifts.createGift(db, owner, owner, { contactId: cA._id, tagId: 'jiehun', amount: 150000, date: daysAgo(2) });
  // cB：只有未授权事件 evB 的收礼（成员视角用）
  await core.receive.createRecord(db, owner, owner, evB._id, { contactId: cB._id, amount: 50000, type: '转账', date: TODAY });
  // cR：6 条送礼，专供时间筛选
  const rangeGifts = [
    [TODAY, 10001], [MONTH_START, 10002], [PREV_MONTH_END, 10003],
    [YEAR_START, 10004], [PREV_YEAR_END, 10005], [D400, 10006],
  ];
  for (const [date, amount] of rangeGifts) {
    await core.gifts.createGift(db, owner, owner, { contactId: cR._id, tagId: 'qita', amount, date });
  }
  return { owner, cA: cA._id, cB: cB._id, cC: cC._id, cR: cR._id, evA: evA._id, evB: evB._id };
}

async function amounts(db, owner, contactId, range) {
  const tl = await stats.timeline(db, owner, contactId, { range });
  return tl.items.map((i) => i.amountFen);
}

// ---------- contactStats ----------
test('往来统计：收/送混合数字正确，差额=收到-送出', async () => {
  const db = await h.newDB();
  const { owner, cA } = await setup(db);
  const st = await stats.contactStats(db, owner, cA, { range: { start: D400, end: TODAY } });
  assert.eq(st.receiveTotalFen, 120000, '收礼总额');
  assert.eq(st.receiveCount, 2, '收礼笔数');
  assert.eq(st.giftTotalFen, 180000, '送礼总额');
  assert.eq(st.giftCount, 2, '送礼笔数');
  assert.eq(st.diffFen, -60000, '差额=收到-送出（可为负）');
});

test('往来统计：空数据返回零', async () => {
  const db = await h.newDB();
  const { owner, cC } = await setup(db);
  const st = await stats.contactStats(db, owner, cC, { range: 'today' });
  assert.eq(st.receiveTotalFen, 0, '收礼0');
  assert.eq(st.giftTotalFen, 0, '送礼0');
  assert.eq(st.receiveCount, 0, '笔数0');
  assert.eq(st.diffFen, 0, '差额0');
});

// ---------- timeline ----------
test('竖线树：时间从早到晚，字段齐全', async () => {
  const db = await h.newDB();
  const { owner, cA } = await setup(db);
  const tl = await stats.timeline(db, owner, cA, { range: { start: D400, end: TODAY } });
  assert.eq(tl.items.length, 4, '共4条');
  for (let i = 1; i < tl.items.length; i++) {
    assert(tl.items[i - 1].date <= tl.items[i].date, `第${i}条不早于前一条`);
  }
  assert.eq(tl.items[0].date, D400, '最早的是400天前的收礼');
  assert.eq(tl.items[0].type, 'receive', '类型receive');
  assert.eq(tl.items[0].tagName, '其他', '收礼标签跟随事件');
  const gift = tl.items.find((i) => i.type === 'gift' && i.amountFen === 30000);
  assert(gift, '找到送礼30000');
  assert.eq(gift.tagName, '生日', '送礼标签名');
  assert.eq(gift.amountFen, 30000, '金额以分返回，不拼字符串');
  assert(typeof gift.amountFen === 'number', 'amountFen为数字');
});

// ---------- 时间筛选（五种） ----------
test('时间筛选：today', async () => {
  const db = await h.newDB();
  const { owner, cR } = await setup(db);
  const got = await amounts(db, owner, cR, 'today');
  assert.eq(JSON.stringify(got), JSON.stringify([10001]), '只含今天');
});

test('时间筛选：month', async () => {
  const db = await h.newDB();
  const { owner, cR } = await setup(db);
  const got = await amounts(db, owner, cR, 'month');
  assert(got.includes(10001) && got.includes(10002), '含本月两条');
  assert(!got.includes(10003), '不含上月末');
});

test('时间筛选：year', async () => {
  const db = await h.newDB();
  const { owner, cR } = await setup(db);
  const got = await amounts(db, owner, cR, 'year');
  for (const a of [10001, 10002, 10004]) assert(got.includes(a), `应含${a}`);
  assert(!got.includes(10005), '不含去年末');
  assert(!got.includes(10006), '不含400天前');
  if (IS_JAN) assert(!got.includes(10003), '1月时上月末属去年');
  else assert(got.includes(10003), '非1月时上月末属今年');
});

test('时间筛选：lastYear', async () => {
  const db = await h.newDB();
  const { owner, cR } = await setup(db);
  const got = await amounts(db, owner, cR, 'lastYear');
  for (const a of [10001, 10002, 10003, 10004, 10005]) assert(got.includes(a), `应含${a}`);
  assert(!got.includes(10006), '不含400天前');
});

test('时间筛选：自定义起止（含当天）', async () => {
  const db = await h.newDB();
  const { owner, cR } = await setup(db);
  const got = await amounts(db, owner, cR, { start: D400, end: D400 });
  assert.eq(JSON.stringify(got), JSON.stringify([10006]), '只含起止当天');
});

test('时间筛选：非法范围抛错', async () => {
  const db = await h.newDB();
  const { owner, cA } = await setup(db);
  let e1 = null, e2 = null;
  try { await stats.contactStats(db, owner, cA, { range: { start: TODAY, end: D400 } }); } catch (e) { e1 = e; }
  try { await stats.contactStats(db, owner, cA, { range: 'not-a-range' }); } catch (e) { e2 = e; }
  assert(e1, '起始晚于结束应抛错');
  assert(e2, '未知预设应抛错');
});

// ---------- memberStats 三件套 ----------
test('成员视角：有权限能成功，只算授权部分', async () => {
  const db = await h.newDB();
  const { owner, cA, evA } = await setup(db);
  const { member } = await h.setupMember(db, owner, { events: [evA], gifts: true });
  const st = await stats.memberStats(db, member, owner, cA, { range: { start: D400, end: TODAY } });
  assert.eq(st.isMember, true, '成员标识');
  assert.eq(st.receiveTotalFen, 100000, '只含授权事件evA的收礼');
  assert.eq(st.receiveCount, 1, '未授权事件的收礼不计');
  assert.eq(st.giftTotalFen, 180000, 'gifts授权则送礼全计');
  assert.eq(st.diffFen, -80000, '差额');
});

test('成员视角：gifts未授权则送礼不计', async () => {
  const db = await h.newDB();
  const { owner, cA, evA } = await setup(db);
  const { member } = await h.setupMember(db, owner, { events: [evA], gifts: false });
  const st = await stats.memberStats(db, member, owner, cA, { range: { start: D400, end: TODAY } });
  assert.eq(st.giftTotalFen, 0, '送礼不计');
  assert.eq(st.giftCount, 0, '送礼笔数0');
  assert.eq(st.receiveTotalFen, 100000, '收礼照常');
});

test('成员视角：无权限被拒绝（陌生人）', async () => {
  const db = await h.newDB();
  const { owner, cA } = await setup(db);
  const stranger = await h.newUser(db, 'stranger1');
  const before = await core.stats.contactStats(db, owner, cA, { range: { start: D400, end: TODAY } });
  let err = null;
  try { await stats.memberStats(db, stranger, owner, cA); } catch (e) { err = e; }
  assert(err, '应抛错');
  assert(err.message.startsWith('无权限'), '用户可读的拒绝文案');
  const after = await core.stats.contactStats(db, owner, cA, { range: { start: D400, end: TODAY } });
  assert.eq(JSON.stringify(after), JSON.stringify(before), '拒绝后数据未变');
});

test('成员视角：联系人不在授权记录里 → 拒绝', async () => {
  const db = await h.newDB();
  const { owner, cB, evA } = await setup(db);
  // cB 的收礼只在未授权事件 evB 里
  const { member } = await h.setupMember(db, owner, { events: [evA], gifts: true });
  let err = null;
  try { await stats.memberStats(db, member, owner, cB, { range: 'today' }); } catch (e) { err = e; }
  assert(err, '应拒绝');
  assert.eq(err.code, 'out-of-scope:contact', '原因码为联系人越权');
});

test('成员视角：空身份被拒绝', async () => {
  const db = await h.newDB();
  const { owner, cA } = await setup(db);
  let err = null;
  try { await stats.memberStats(db, '', owner, cA); } catch (e) { err = e; }
  assert(err && err.code === 'empty-identity', '空身份拒绝');
});

// ---------- findContactsByName ----------
test('按姓名找联系人：模糊匹配', async () => {
  const db = await h.newDB();
  const { owner } = await setup(db);
  const r1 = await stats.findContactsByName(db, owner, '张');
  assert.eq(r1.length, 2, '张→张三、张小三');
  const r2 = await stats.findContactsByName(db, owner, '张三');
  assert.eq(r2.length, 1, '张三→只有张三（张小三中"张三"不连续）');
  const r3 = await stats.findContactsByName(db, owner, '李四');
  assert.eq(r3.length, 1, '李四→1个');
  const r4 = await stats.findContactsByName(db, owner, '同学');
  assert.eq(r4.length, 1, '备注也能搜到');
  const r5 = await stats.findContactsByName(db, owner, '不存在');
  assert.eq(r5.length, 0, '无匹配');
  const r6 = await stats.findContactsByName(db, owner, '  ');
  assert.eq(r6.length, 0, '空关键字返回空');
});
