/**
 * 老板平台补全（任务M）：第3/4/6/7/10/11项真接口 + 配置编辑落库。
 *
 * 铁律延续 test-admin：用带特征串的账本数据（姓名/备注/礼薄名/礼金金额）
 * 断言任何 admin 响应都不含这些串；每个新接口都验管理员校验
 * （非管理员拒绝、无名单 fail closed）；限制标记验写入口拦截生效。
 * 注意：订单金额、反馈正文是平台数据（任务口径可显示），不属账本哨兵。
 */
const { test, assert } = require('./fw');
const { newDB, newUser } = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const admin = core.admin;

const BOSS = 'boss_openid_admin';
const NOBODY = 'random_user_x';

const NAME_MARK = '赵六_T3ST_甲';
const REMARK_MARK = '特征备注_T3ST_乙';
const EVENT_MARK = '婚宴_T3ST_丙';
const AMOUNT_FEN = 1234567; // 礼金特征金额（分）
const MARKS = [NAME_MARK, REMARK_MARK, EVENT_MARK, String(AMOUNT_FEN), '12345.67'];

function assertNoLeak(obj, label) {
  const s = JSON.stringify(obj);
  for (const m of MARKS) assert(!s.includes(m), `${label} 泄露账本内容: ${m}`);
}

async function seedAdmin(db) {
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
}

/** ownerA：会员，账本含全部特征串；返回 {ownerA, contactId, eventId} */
async function setupLedger(db) {
  const ownerA = await newUser(db, 'ownerA_openid_001', {
    status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null,
  });
  const c = await core.contacts.createContact(db, ownerA, ownerA, { name: NAME_MARK, remark: REMARK_MARK });
  const ev = await core.receive.createEvent(db, ownerA, ownerA, { name: EVENT_MARK, tagId: 'jiehun', date: '2026-10-01' });
  await core.receive.createRecord(db, ownerA, ownerA, ev._id, {
    contactId: c._id, amount: AMOUNT_FEN, type: '现金', remark: REMARK_MARK, date: '2026-10-01',
  });
  await core.gifts.createGift(db, ownerA, ownerA, {
    contactId: c._id, tagId: 'jiehun', amount: AMOUNT_FEN, remark: REMARK_MARK, date: '2026-10-02',
  });
  return { ownerA, contactId: c._id, eventId: ev._id };
}

async function expectNotAdmin(promise, label) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err && err.code === 'not-admin', `${label} 非管理员应以 not-admin 被拒（实际 ${err && err.code}）`);
}

test('admin补全：全部新接口非管理员拒绝、无名单 fail closed', async () => {
  const db = await newDB();
  await seedAdmin(db);
  await expectNotAdmin(admin.searchAccounts(db, NOBODY, {}), 'searchAccounts');
  await expectNotAdmin(admin.importUsage(db, NOBODY, {}), 'importUsage');
  await expectNotAdmin(admin.feedbackList(db, NOBODY, {}), 'feedbackList');
  await expectNotAdmin(admin.feedbackSetStatus(db, NOBODY, 'x', 'handled'), 'feedbackSetStatus');
  await expectNotAdmin(admin.orderList(db, NOBODY, {}), 'orderList');
  await expectNotAdmin(admin.orderStats(db, NOBODY), 'orderStats');
  await expectNotAdmin(admin.listAdmins(db, NOBODY), 'listAdmins');
  await expectNotAdmin(admin.auditTrail(db, NOBODY, {}), 'auditTrail');
  await expectNotAdmin(admin.setUserRestricted(db, NOBODY, 'abc***xyz', { restricted: true, reason: 'x' }), 'setUserRestricted');

  const db2 = await newDB(); // 完全没有配置文档
  await expectNotAdmin(admin.searchAccounts(db2, BOSS, {}), '无名单 searchAccounts');
  await expectNotAdmin(admin.orderStats(db2, BOSS), '无名单 orderStats');
});

test('admin补全：账号查询只回条数汇总、白名单字段、无账本泄露', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const { ownerA } = await setupLedger(db);
  await newUser(db, 'ownerB_openid_002');

  const masked = admin.maskUserId(ownerA);
  const frag = masked.slice(-3); // 尾号片段，两位用户不撞
  const r = await admin.searchAccounts(db, BOSS, { maskedId: frag });
  assert.eq(r.total, 1, '按编号片段只命中本人');
  const row = r.items[0];
  assert.eq(row.userId, masked, '编号脱敏');
  assert.eq(row.memberState, 'member', '会员状态正确');
  assert.eq(row.counts.events, 1, '礼薄数');
  assert.eq(row.counts.records, 1, '收礼条数');
  assert.eq(row.counts.gifts, 1, '送礼条数');
  assert.eq(row.counts.contacts, 1, '亲友数');
  assert.eq(row.restricted, false, '未受限');
  assert.eq(
    Object.keys(row).sort().join(','),
    'counts,createdAt,memberState,restrictReason,restricted,userId',
    '账号查询字段白名单'
  );
  assertNoLeak(r, 'searchAccounts');

  const future = await admin.searchAccounts(db, BOSS, { from: Date.now() + 86400e3 });
  assert.eq(future.total, 0, '注册时间段过滤（未来无用户）');
  const all = await admin.searchAccounts(db, BOSS, {});
  assert.eq(all.total, 2, '无条件查全部');
  assertNoLeak(all, 'searchAccounts 全部');
});

test('admin补全：拍照导入用量按日/周聚合、成功率与失败分布、无泄露', async () => {
  const db = await newDB();
  await seedAdmin(db);
  await setupLedger(db); // 账本哨兵数据（验泄露用）
  // 导入尝试用独立的免费用户：免费送礼额度 30 条，便于造额度拦截
  const imp = await newUser(db, 'importer_openid_007');
  const ic = await core.contacts.createContact(db, imp, imp, { name: '导入亲友' });
  const contactId = ic._id;
  const ownerA = imp;

  // 成功一批（送礼 1 条）
  const ok = await core.importer.writeImport(db, ownerA, ownerA, {
    kind: 'gift', items: [{ contactId, amountFen: 50000 }],
  });
  assert.eq(ok.written, 1, '成功批写入');
  // 校验失败一批（亲友不存在）
  const bad = await core.importer.writeImport(db, ownerA, ownerA, {
    kind: 'gift', items: [{ contactId: 'no_such_contact', amountFen: 100 }],
  });
  assert(bad.rawError, '校验批被拒');
  // 额度拦截一批（免费额度 50 条、已用 1 条，再导 50 条整批超额）
  const many = Array.from({ length: 50 }, () => ({ contactId, amountFen: 100 }));
  const over = await core.importer.writeImport(db, ownerA, ownerA, { kind: 'gift', items: many });
  assert(over.rawError && String(over.rawError.code || '').startsWith('quota-exceeded'), '额度批被拒');

  const day = await admin.importUsage(db, BOSS, { granularity: 'day' });
  assert.eq(day.total, 3, '三次导入尝试都记账');
  assert.eq(day.success, 1, '成功 1 次');
  assert.eq(day.failed, 2, '失败 2 次');
  assert.eq(day.successRate, 33.3, '成功率');
  const reasons = Object.fromEntries(day.failReasons.map((r) => [r.reason, r.count]));
  assert.eq(reasons.validation, 1, '失败分布含校验');
  assert.eq(reasons.quota, 1, '失败分布含额度');
  assert.eq(day.byPeriod.length, 1, '同一天一个周期');
  assert.eq(day.byPeriod[0].total, 3, '周期内总数');
  assertNoLeak(day, 'importUsage');

  const week = await admin.importUsage(db, BOSS, { granularity: 'week' });
  assert.eq(week.total, 3, '按周聚合总数一致');
  assertNoLeak(week, 'importUsage 周');
});

test('admin补全：反馈列表脱敏+详情可读、标记已处理并写审计', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const { ownerA } = await setupLedger(db);
  const { feedbackId } = await core.feedback.submitFeedback(db, ownerA, { content: '希望能导出PDF' });

  const r = await admin.feedbackList(db, BOSS, {});
  assert.eq(r.total, 1, '反馈总数');
  assert.eq(r.items[0].content, '希望能导出PDF', '反馈正文（用户主动提交）可显示');
  assert.eq(r.items[0].userId, admin.maskUserId(ownerA), '提交人脱敏');
  assert.eq(r.items[0].status, 'pending', '初始待处理');
  assertNoLeak(r, 'feedbackList');

  const done = await admin.feedbackSetStatus(db, BOSS, feedbackId, 'handled');
  assert(done.ok, '标记成功');
  const r2 = await admin.feedbackList(db, BOSS, { status: 'handled' });
  assert.eq(r2.total, 1, '按已处理过滤命中');
  const trail = await admin.auditTrail(db, BOSS, { action: 'feedback' });
  assert.eq(trail.total, 1, '处理反馈写了审计');
  assert(trail.items[0].detail.includes('已处理'), '审计摘要正确');
});

test('admin补全：订单列表与收入汇总（脱敏、按档位聚合、退款可见）', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const buyer = await newUser(db, 'buyer_openid_009');
  const adapter = new core.payAdapter.MockPayAdapter({ result: 'success' });
  const buy = await core.payment.purchase(db, buyer, 'month', { adapter });
  assert(buy.delivered, '模拟支付发货成功');
  const buy2 = await core.payment.purchase(db, buyer, 'year', { adapter });
  assert(buy2.delivered, '第二单发货成功');
  await core.payment.refund(db, buy2.order._id, { actorId: buyer });
  await core.payment.createOrder(db, buyer, 'month'); // 待支付单

  const stats = await admin.orderStats(db, BOSS);
  assert.eq(stats.totalOrders, 3, '订单总数');
  assert.eq(stats.byStatus.paid, 1, '已支付 1');
  assert.eq(stats.byStatus.refunded, 1, '已退款 1');
  assert.eq(stats.byStatus.pending, 1, '待支付 1');
  assert.eq(stats.paidRevenueFen, core.config.pricing[0].priceFen, '已付收入=月卡占位价');
  assert.eq(stats.refundedFen, core.config.pricing[2].priceFen, '退款金额=年卡价格');
  const monthly = stats.byPlan.find((p) => p.planId === 'month');
  assert.eq(monthly.orders, 2, '月卡共 2 单');
  assert.eq(monthly.paidCount, 1, '月卡已付 1 单');
  assertNoLeak(stats, 'orderStats');

  const list = await admin.orderList(db, BOSS, {});
  assert.eq(list.total, 3, '列表总数');
  assert(list.items.every((o) => o.userId === admin.maskUserId(buyer)), '用户全部脱敏');
  assertEqKeys(list.items[0]);
  const refunded = await admin.orderList(db, BOSS, { status: 'refunded' });
  assert.eq(refunded.total, 1, '按已退款过滤');
  assert(refunded.items[0].refundedAt > 0, '退款时间可见');
  assertNoLeak(list, 'orderList');

  function assertEqKeys(o) {
    assert.eq(
      Object.keys(o).sort().join(','),
      'amountFen,channel,createdAt,days,mock,orderId,outTradeNo,paidAt,planName,refundedAt,status,userId', // 任务AF：订单行新增 mock 标记（模拟渠道订单可辨识）
      '订单列表字段白名单'
    );
  }
});

test('admin补全：管理员名单脱敏只读、操作记录过滤与 actor 脱敏', async () => {
  const db = await newDB();
  await seedAdmin(db);
  await admin.updatePricing(db, BOSS, [{ id: 'm1', name: '月卡', priceFen: 100, days: 30 }]);

  const admins = await admin.listAdmins(db, BOSS);
  assert.eq(admins.count, 1, '管理员 1 人');
  assert(admins.admins[0].includes('***'), '管理员编号脱敏');
  assert(!admins.admins[0].includes(BOSS), '不露管理员原文');

  const trail = await admin.auditTrail(db, BOSS, { action: 'config' });
  assert(trail.total >= 1, '配置修改有审计');
  assert(trail.items[0].actorId.includes('***') || trail.items[0].actorId.length <= 8, 'actor 脱敏');
  assert(!JSON.stringify(trail).includes(BOSS), '审计列表不露 actor 原文');
  assertEqTrailKeys(trail.items[0]);

  function assertEqTrailKeys(a) {
    assert.eq(
      Object.keys(a).sort().join(','),
      'action,actorId,createdAt,detail,targetType',
      '操作记录字段白名单'
    );
  }
});

test('admin补全：限制标记拦截全部写入口、读不受影响、解除后恢复', async () => {
  const db = await newDB();
  await seedAdmin(db);
  const { ownerA, contactId, eventId } = await setupLedger(db);
  const masked = admin.maskUserId(ownerA);

  // 无原因限制被拒
  let e0 = null;
  try { await admin.setUserRestricted(db, BOSS, masked, { restricted: true }); } catch (e) { e0 = e; }
  assert(e0 && e0.code === 'bad-config', '限制必须填原因');

  const r = await admin.setUserRestricted(db, BOSS, masked, { restricted: true, reason: '异常刷量' });
  assert.eq(r.restricted, true, '已限制');
  const found = await admin.searchAccounts(db, BOSS, { maskedId: masked.slice(-3) });
  assert.eq(found.items[0].restricted, true, '账号查询能看到受限');
  assert.eq(found.items[0].restrictReason, '异常刷量', '限制原因可见');

  const writes = [
    ['新增亲友', () => core.contacts.createContact(db, ownerA, ownerA, { name: '新人' })],
    ['改亲友', () => core.contacts.updateContact(db, ownerA, ownerA, contactId, { name: '改名' })],
    ['删亲友', () => core.contacts.deleteContact(db, ownerA, ownerA, contactId, true)],
    ['新建礼薄', () => core.receive.createEvent(db, ownerA, ownerA, { name: '新礼薄', tagId: 'qita', date: '2026-10-03' })],
    ['记收礼', () => core.receive.createRecord(db, ownerA, ownerA, eventId, { contactId, amount: 100, type: '现金', date: '2026-10-03' })],
    ['记送礼', () => core.gifts.createGift(db, ownerA, ownerA, { contactId, tagId: 'qita', amount: 100, date: '2026-10-03' })],
    ['改送礼', () => core.gifts.updateGift(db, ownerA, ownerA, 'whatever', { amount: 200 })],
    ['拍照导入写入', () => core.importer.writeImport(db, ownerA, ownerA, { kind: 'gift', items: [{ contactId, amountFen: 100 }] })],
    ['拍照导入任务', () => core.importer.startImportTask(db, ownerA, ownerA, { kind: 'gift', imagePath: 'x.jpg' })],
    ['共享邀请', () => core.share.invite(db, ownerA, { switches: { view: true }, scope: { events: [eventId], gifts: false } })],
  ];
  for (const [label, fn] of writes) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    assert(err && err.code === 'user-restricted', `${label} 应被限制拦截（实际 ${err && (err.code || err.message)}）`);
  }

  // 读不受影响
  const contacts = await core.contacts.listContacts(db, ownerA, ownerA);
  assert(contacts.length >= 1, '受限后仍可查看亲友');

  // 解除后恢复
  await admin.setUserRestricted(db, BOSS, masked, { restricted: false });
  const c2 = await core.contacts.createContact(db, ownerA, ownerA, { name: '恢复后新建' });
  assert(c2._id, '解除限制后可继续记账');

  const trail = await admin.auditTrail(db, BOSS, { action: 'restrict' });
  assert.eq(trail.total, 1, '限制操作有审计');
  const trail2 = await admin.auditTrail(db, BOSS, { action: 'unrestrict' });
  assert.eq(trail2.total, 1, '解除操作有审计');
});

test('admin补全：配置编辑落库生效（价格/额度）+审计，支付取到新价', async () => {
  const db = await newDB();
  await seedAdmin(db);
  await admin.updatePricing(db, BOSS, [
    { id: 'month', name: '月卡', priceFen: 100, days: 30 },
    { id: 'year', name: '年卡', priceFen: 1000, days: 365 },
  ]);
  await admin.updateQuotaSettings(db, BOSS, { freeQuota: { giftRecords: 66 } });

  const cfg = await admin.getConfig(db, BOSS);
  assert.eq(cfg.pricing.length, 2, '两档价格已落库');
  assert.eq(cfg.pricing[0].priceFen, 100, '月卡占位价 100 分');
  assert.eq(cfg.pricing[1].priceFen, 1000, '年卡占位价 1000 分');
  assert.eq(cfg.freeQuota.giftRecords, 66, '额度改动落库');

  const buyer = await newUser(db, 'buyer2_openid');
  const order = await core.payment.createOrder(db, buyer, 'year');
  assert.eq(order.amountFen, 1000, '下单取到平台新价（页面/下单不写死价格）');

  const trail = await admin.auditTrail(db, BOSS, { action: 'config' });
  assert(trail.total >= 2, '两次配置修改都有审计');
});

test('admin：配置文档只有部分段时 getConfig 各段回落静态默认（pricing 不为空）', async () => {
  const db = await newDB();
  // 只写一个仅含 adminIds 的 singleton（模拟演示 ensureDemoAdmin 落库形态）
  await seedAdmin(db);
  const cfg = await admin.getConfig(db, BOSS);
  assert(Array.isArray(cfg.pricing) && cfg.pricing.length >= 4, 'pricing 应回落静态四档而非空数组');
  assert(cfg.pricing.every((x) => x.id && x.priceFen > 0 && x.days > 0), '回落档位字段完整');
  assert(cfg.freeQuota && cfg.freeQuota.contacts === 50, 'freeQuota 回落');
  assert(cfg.paymentPlatforms && typeof cfg.paymentPlatforms === 'object', 'paymentPlatforms 回落');
});

test('账号查询页带用户列表（2026-10-24 用户要求）：打开即列表＋点行复制编号＋加载更多（静态）', () => {
  const fs = require('fs'); const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/admin/account/account.js'), 'utf8');
  assert(js.includes('this.loadPage(1, false)'), 'onLoad 应自动加载第一页用户列表');
  assert(js.includes('onCopyId') && js.includes('setClipboardData'), '点行应可复制脱敏编号');
  assert(js.includes('onLoadMore'), '应有加载更多');
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/admin/account/account.wxml'), 'utf8');
  assert(wxml.includes('bindtap="onCopyId"'), '列表行应绑定点按复制');
  assert(wxml.includes('onLoadMore'), '应有加载更多按钮');
});
