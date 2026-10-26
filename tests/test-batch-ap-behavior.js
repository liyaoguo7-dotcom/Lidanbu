/** AP批行为测试：往来页联系人排序改定（用户 2026-10-26 定）——
 * 按"最近往来时间"倒序：每人以当前筛选范围内最近一笔的日期为键，新→旧；
 * 同日期再按笔数多→少、姓名 localeCompare 兜底。替代原"笔数优先"排序。
 * 同时断言 contactStats/memberStats 同口径带出 lastDate（成员路径共用）。 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

const MEMBER = { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null };

async function seedSortData(db) {
  const owner = await h.newUser(db, 'ap-owner', MEMBER);
  const mk = async (name, dates) => {
    const c = await core.contacts.createContact(db, owner, owner, { name });
    for (const d of dates) {
      await core.gifts.createGift(db, owner, owner, {
        contactId: c._id, tagId: 'qita', amount: 10000, date: d,
      });
    }
    return c._id;
  };
  // 老彭：笔数最多（3 笔）但最近一笔最旧（2024-06-01）——旧口径排第一，新口径应垫底
  await mk('老彭', ['2024-03-01', '2024-05-01', '2024-06-01']);
  // 新近：只有 1 笔，但日期最新（2026-02-01）——新口径应排第一
  await mk('新近', ['2026-02-01']);
  // 跨年：2025-12-31，居中（验跨年字符串日期比较）
  await mk('跨年', ['2025-12-31']);
  // 同日期组（2025-06-15）：多笔 2 笔应先于 1 笔；安平/白平同笔数按姓名兜底
  await mk('多笔', ['2025-06-15', '2025-06-15']);
  await mk('安平', ['2025-06-15']);
  await mk('白平', ['2025-06-15']);
  return owner;
}

test('AP 往来排序：最近往来时间倒序压过笔数，含跨年与同日期兜底', async () => {
  const db = await h.newDB();
  const owner = await seedSortData(db);
  const r = await core.stats.wanglaiList(db, owner, owner, { range: 'all' });
  assert.eq(r.rows.map((x) => x.name).join(','), '新近,跨年,多笔,安平,白平,老彭',
    '顺序应为 lastDate 新→旧；同日期笔数多→少；再同按姓名');
  assert.eq(r.rows[0].lastDate, '2026-02-01', '第一名 lastDate 为其最近一笔');
  assert.eq(r.rows[5].lastDate, '2024-06-01', '老彭 lastDate 取 3 笔里最大日期');
  assert.eq(r.rows[5].count, 3, '老彭笔数仍统计为 3（只是不再优先）');
});

test('AP 往来排序：筛选范围决定 lastDate——范围外记录不参与', async () => {
  const db = await h.newDB();
  const owner = await seedSortData(db);
  const y2026 = await core.stats.wanglaiList(db, owner, owner, { range: { start: '2026-01-01', end: '2026-12-31' } });
  assert.eq(y2026.rows.length, 1, '2026 年范围内只有新近有记录');
  assert.eq(y2026.rows[0].name, '新近', '范围内唯一联系人');
  const y2024 = await core.stats.wanglaiList(db, owner, owner, { range: { start: '2024-01-01', end: '2024-12-31' } });
  assert.eq(y2024.rows.map((x) => x.name).join(','), '老彭', '2024 年范围内只有老彭');
});

test('AP lastDate 口径一致：contactStats 与 memberStats（主人视角）都带出', async () => {
  const db = await h.newDB();
  const owner = await seedSortData(db);
  const contacts = await core.contacts.listContacts(db, owner, owner);
  const lao = contacts.find((c) => c.name === '老彭');
  const cs = await core.stats.contactStats(db, owner, lao._id, { range: 'all' });
  assert.eq(cs.lastDate, '2024-06-01', 'contactStats.lastDate');
  const ms = await core.stats.memberStats(db, owner, owner, lao._id, { range: 'all' });
  assert.eq(ms.lastDate, '2024-06-01', 'memberStats.lastDate 与 contactStats 一致');
});
