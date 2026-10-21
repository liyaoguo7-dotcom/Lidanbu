/** 拍照导入 × 积分门禁（2026-10-21 新口径，高风险）：
 * 顺序铁律 会员 → 积分预检 → 识别 → 识别成功后扣费；额度拦截自动返还。
 * 扣费以 refId='import:'+jobId 绑定任务，points 层幂等保证只扣一次。 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

const importer = core.importer;
const points = core.points;

const MEMBER = () => ({ status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });

async function memberWithPoints(db, id, balance) {
  const owner = await h.newUser(db, id, MEMBER());
  if (balance > 0) {
    await points.grant(db, owner, balance, { kind: 'manual', refId: `seed:${id}`, note: '测试充值' });
  }
  return owner;
}

async function spendEntries(db, userId) {
  const all = await db.collection(COLLECTIONS.PointsLedger).find({ userId, kind: 'photo_import' });
  return all.filter((e) => e.delta < 0);
}

async function refundEntries(db, userId) {
  return db.collection(COLLECTIONS.PointsLedger).find({ userId, kind: 'photo_refund' });
}

test('导入积分：识别成功扣费只一次（同 job 重走任务流不重复扣）', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'p1', 100);
  const r1 = await importer.startImportTask(db, owner, owner, {
    jobId: 'job-once', kind: 'gift', imagePath: 'wxfile://ok.jpg',
  });
  assert.eq(r1.cost, 5, '单价读配置 = 5');
  assert.eq(r1.duplicated, false, '首次扣费');
  assert.eq(r1.items.length, 3, '识别出 3 条');
  assert.eq(await points.getBalance(db, owner), 95, '扣 5 剩 95');

  const r2 = await importer.startImportTask(db, owner, owner, {
    jobId: 'job-once', kind: 'gift', imagePath: 'wxfile://ok.jpg',
  });
  assert.eq(r2.duplicated, true, '同 job 二次走流程识别为重复');
  assert.eq(await points.getBalance(db, owner), 95, '余额不变');
  const spends = await spendEntries(db, owner);
  assert.eq(spends.length, 1, '流水只有一条 spend');
  assert.eq(spends[0].refId, 'import:job-once', 'refId 绑定 job');
});

test('导入积分：同 jobId 两遍完整流程（识别+写入），流水只有一条 spend', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'p2', 100);
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  const jobId = 'job-full-flow';
  for (let round = 0; round < 2; round++) {
    const r = await importer.startImportTask(db, owner, owner, {
      jobId, kind: 'gift', imagePath: 'wxfile://ok.jpg',
    });
    const w = await importer.writeImport(db, owner, owner, {
      kind: 'gift', jobId,
      items: r.items.map((it) => ({ contactId: c._id, amountFen: it.amountFen, note: it.note })),
    });
    assert.eq(w.rawError, null, `第 ${round + 1} 遍写入成功`);
  }
  const spends = await spendEntries(db, owner);
  assert.eq(spends.length, 1, '两遍流程 spend 仍只有一条');
  assert.eq(await points.getBalance(db, owner), 95, '只扣一次 5 分');
});

test('导入积分：识别失败不扣（余额与流水都不动）', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'p3', 100);
  let err = null;
  try {
    await importer.startImportTask(db, owner, owner, {
      jobId: 'job-fail', kind: 'gift', imagePath: 'wxfile://mockfail.jpg',
    });
  } catch (e) { err = e; }
  assert(err && /没认出来/.test(err.message), '识别失败抛错');
  assert.eq(await points.getBalance(db, owner), 100, '余额未扣');
  assert.eq((await spendEntries(db, owner)).length, 0, '无 spend 流水');
});

test('导入积分：额度拦截自动返还全额，且只退一次', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'p4', 100);
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  // 会员期先记满免费口径的 30 条送礼（会员额度高，不会被拦）
  for (let i = 0; i < 30; i++) {
    await core.gifts.createGift(db, owner, owner, { contactId: c._id, tagId: 'qita', amount: 100, date: '2026-10-01' });
  }
  const r = await importer.startImportTask(db, owner, owner, {
    jobId: 'job-quota', kind: 'gift', imagePath: 'wxfile://ok.jpg',
  });
  assert.eq(await points.getBalance(db, owner), 95, '识别成功已扣 5');

  // 模拟会员到期变免费用户：免费送礼额度 30 已满，整批写入被额度拦截
  await db.collection(COLLECTIONS.User).update(
    { _id: owner },
    { membership: { status: 'free', expireAt: null, graceUntil: null } },
  );
  const items = r.items.map((it) => ({ contactId: c._id, amountFen: it.amountFen, note: it.note }));
  const w1 = await importer.writeImport(db, owner, owner, { kind: 'gift', jobId: 'job-quota', items });
  assert(w1.rawError && String(w1.rawError.code).startsWith('quota-exceeded'), '额度拦截');
  assert.eq(w1.written, 0, '整批未写入');
  assert.eq(await points.getBalance(db, owner), 100, '拦截后自动返还到 100');
  assert.eq((await refundEntries(db, owner)).length, 1, '一条返还流水');

  // 再整批重试仍被拦截：不得重复返还
  const w2 = await importer.writeImport(db, owner, owner, { kind: 'gift', jobId: 'job-quota', items });
  assert(w2.rawError && String(w2.rawError.code).startsWith('quota-exceeded'), '仍被拦截');
  assert.eq((await refundEntries(db, owner)).length, 1, '返还只发生一次');
  assert.eq(await points.getBalance(db, owner), 100, '余额仍为 100');
});

test('导入积分：积分不足在识别前拦下，不产生扣款流水', async () => {
  const db = await h.newDB();
  const owner = await memberWithPoints(db, 'p5', 3); // 余额 3 < 单价 5
  let err = null;
  try {
    await importer.startImportTask(db, owner, owner, {
      jobId: 'job-poor', kind: 'gift', imagePath: 'wxfile://ok.jpg',
    });
  } catch (e) { err = e; }
  assert(err && err.code === 'insufficient-points', `抛 insufficient-points（实际 ${err && err.code}）`);
  assert.eq(await points.getBalance(db, owner), 3, '余额不变');
  assert.eq((await spendEntries(db, owner)).length, 0, '无 spend 流水（识别前拦截）');
});

test('导入积分：非会员先被会员门禁拦（顺序：会员→积分→识别）', async () => {
  const db = await h.newDB();
  // 免费用户且余额为 0：若顺序错（先查积分）会抛 insufficient-points
  const owner = await h.newUser(db, 'p6', { status: 'free', expireAt: null, graceUntil: null });
  let err = null;
  try {
    await importer.startImportTask(db, owner, owner, {
      jobId: 'job-free', kind: 'gift', imagePath: 'wxfile://ok.jpg',
    });
  } catch (e) { err = e; }
  assert(err && err.code === 'member-required', `抛 member-required（实际 ${err && err.code}）`);
  assert.eq((await spendEntries(db, owner)).length, 0, '无 spend 流水');
});
