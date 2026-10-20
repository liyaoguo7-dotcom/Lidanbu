/** 邀请得名额测试（高风险：额度发放/防刷/上限/审计）
 * 规则：新用户经邀请码绑定 + 完成有效动作 → 邀请人收礼额度池 +10、送礼 +5；
 * 每对只发一次；上限 maxSuccessfulInvites。
 * 有效动作（2026-10-20 确认口径）：创建一个礼薄并添加一位收礼亲友，
 * 或添加一位送礼亲友。「亲友」= 本人新建联系人（createdBy=本人，
 * 排除演示种子联系人），且该联系人被用于 ≥1 条对应记录。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const IR = core.inviteReward;

const BOSS = 'boss_openid_1';

async function expectInviteErr(promise, code) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `应抛错 ${code} 但成功了`);
  assert.eq(err.code, code, '错误原因码');
  return err;
}

/** 建邀请人+被邀请人并完成绑定，返回 {code} */
async function setupBound(db, inviterId, inviteeId, deviceId) {
  await h.newUser(db, inviterId);
  await h.newUser(db, inviteeId);
  const code = await IR.getOrCreateInviteCode(db, inviterId);
  await IR.bindInvite(db, inviteeId, { code, deviceId });
  return { code };
}

/** 被邀请人完成收礼路径：新建联系人（本人建）+ 1 礼薄 + 用该联系人记 1 条收礼 */
async function actReceive(db, inviteeId) {
  const c = await core.contacts.createContact(db, inviteeId, inviteeId, { name: '亲友甲' });
  const ev = await core.receive.createEvent(db, inviteeId, inviteeId, { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  await core.receive.createRecord(db, inviteeId, inviteeId, ev._id, { contactId: c._id, amount: 10000, type: '现金', date: '2026-10-01' });
}

/** 被邀请人完成送礼路径：新建联系人（本人建）+ 用该联系人记 1 条送礼 */
async function actGift(db, inviteeId) {
  const c = await core.contacts.createContact(db, inviteeId, inviteeId, { name: '亲友甲' });
  await core.gifts.createGift(db, inviteeId, inviteeId, { contactId: c._id, tagId: 'shengri', amount: 5000, date: '2026-10-01' });
}

/** 带邀请奖励的有效额度（与服务端 checkAddQuota 同口径） */
async function effQuota(db, userId) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: userId });
  const successfulInvites = await IR.countSuccessfulInvites(db, userId);
  const settings = await core.quota.resolveInviteSettings(db);
  return core.quota.getEffectiveQuota(user, core.config, Date.now(), { successfulInvites, settings });
}

async function grantsOf(db, inviterId) {
  return db.collection(COLLECTIONS.InviteRewardGrant).find({ userId: inviterId });
}

test('邀请奖励：条件未完成不发放', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  let r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, false, '什么都没做不应发放');
  assert.eq(r.reason, 'invite-condition-incomplete', '原因应为条件未完成');
  // 只建礼薄、不记收礼记录：仍不满足（需要礼薄+记录）
  await core.receive.createEvent(db, 'invitee1', 'invitee1', { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, false, '只有礼薄不应发放');
  assert.eq((await grantsOf(db, 'inviter1')).length, 0, '未发放时不应有发放记录');
  const q = await effQuota(db, 'inviter1');
  assert.eq(q.receivePool, 0, '未发放时额度池为0');
  assert.eq(q.giftRecords, 30, '未发放时送礼额度为免费30');
});

test('邀请奖励：完成收礼条件后发放+10/+5且额度生效', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  await actReceive(db, 'invitee1');
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, true, '条件完成应发放');
  assert.eq(r.poolGranted, 10, '收礼池应发10');
  assert.eq(r.giftsGranted, 5, '送礼应发5');
  const grants = await grantsOf(db, 'inviter1');
  assert.eq(grants.length, 1, '应有1条发放记录');
  assert.eq(grants[0].invitedUserId, 'invitee1', '发放记录应指向被邀请人');
  const q = await effQuota(db, 'inviter1');
  assert.eq(q.receivePool, 10, '有效额度收礼池应为10');
  assert.eq(q.giftRecords, 35, '有效额度送礼应为免费30+奖励5');
  assert.eq(q.receiveEvents, 3, '邀请奖励不增加礼薄个数');
  assert.eq(q.recordsPerEvent, 30, '邀请奖励不增加每礼薄上限');
});

test('邀请奖励：只记送礼也可发放（送礼路径）', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  await actGift(db, 'invitee1');
  const elig = await IR.checkEligibility(db, 'invitee1');
  assert.eq(elig.pathGift, true, '送礼路径应成立');
  assert.eq(elig.pathReceive, false, '收礼路径不应成立');
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, true, '送礼路径应发放');
  assert.eq((await grantsOf(db, 'inviter1')).length, 1, '应有1条发放记录');
});

test('邀请奖励：用种子/旧联系人记一笔不发放（确认口径）', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  // 演示种子联系人：挂在本人名下，但带 seed 标记（任务D种子写入形态）
  const { _id: seedId } = await db.collection(COLLECTIONS.Contact).insert({
    ownerId: 'invitee1', name: '张三', remark: '同学', createdBy: 'invitee1', seed: true, createdAt: Date.now(),
  });
  // 旧数据联系人：无 createdBy 字段，不算"本人新建"
  const { _id: legacyId } = await db.collection(COLLECTIONS.Contact).insert({
    ownerId: 'invitee1', name: '旧相识', remark: '', createdAt: Date.now(),
  });
  // 旧口径下"建礼薄+用种子联系人记1条收礼"就会发放；新口径不算
  const ev = await core.receive.createEvent(db, 'invitee1', 'invitee1', { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  await core.receive.createRecord(db, 'invitee1', 'invitee1', ev._id, { contactId: seedId, amount: 10000, type: '现金', date: '2026-10-01' });
  let elig = await IR.checkEligibility(db, 'invitee1');
  assert.eq(elig.receiveFriend, false, '种子联系人不算收礼亲友');
  assert.eq(elig.pathReceive, false, '用种子联系人记收礼不应成立收礼路径');
  // 用旧联系人记送礼同样不算
  await core.gifts.createGift(db, 'invitee1', 'invitee1', { contactId: legacyId, tagId: 'shengri', amount: 5000, date: '2026-10-01' });
  elig = await IR.checkEligibility(db, 'invitee1');
  assert.eq(elig.giftFriend, false, '无 createdBy 的旧联系人不算送礼亲友');
  assert.eq(elig.eligible, false, '只用种子/旧联系人不应满足有效动作');
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, false, '用种子/旧联系人记一笔不应发放');
  assert.eq(r.reason, 'invite-condition-incomplete', '原因应为条件未完成');
  assert.eq((await grantsOf(db, 'inviter1')).length, 0, '不应有发放记录');
  // 换成本人新建联系人记一笔送礼 → 立即满足并发放
  await actGift(db, 'invitee1');
  const r2 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r2.granted, true, '本人新建亲友记送礼后应发放');
  assert.eq((await grantsOf(db, 'inviter1')).length, 1, '应有1条发放记录');
});

test('邀请奖励：只建礼薄、没加亲友不发放（确认口径）', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  await core.receive.createEvent(db, 'invitee1', 'invitee1', { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  const elig = await IR.checkEligibility(db, 'invitee1');
  assert.eq(elig.events, 1, '已有1个礼薄');
  assert.eq(elig.ownNewContacts, 0, '未添加任何本人新建亲友');
  assert.eq(elig.pathReceive, false, '只有礼薄没有收礼亲友不应成立');
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, false, '只建礼薄不应发放');
  assert.eq((await grantsOf(db, 'inviter1')).length, 0, '不应有发放记录');
});

test('邀请奖励：加了亲友但没用于任何记录不发放（确认口径）', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  const c = await core.contacts.createContact(db, 'invitee1', 'invitee1', { name: '亲友甲' });
  const ev = await core.receive.createEvent(db, 'invitee1', 'invitee1', { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  let elig = await IR.checkEligibility(db, 'invitee1');
  assert.eq(elig.ownNewContacts, 1, '已添加1位本人新建亲友');
  assert.eq(elig.receiveFriend, false, '亲友还没被用于任何收礼记录');
  assert.eq(elig.eligible, false, '亲友未被用于记录不应满足有效动作');
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, false, '加了亲友但没记一笔不应发放');
  assert.eq((await grantsOf(db, 'inviter1')).length, 0, '不应有发放记录');
  // 用这位亲友记上第一笔收礼 → 满足并发放
  await core.receive.createRecord(db, 'invitee1', 'invitee1', ev._id, { contactId: c._id, amount: 10000, type: '现金', date: '2026-10-01' });
  elig = await IR.checkEligibility(db, 'invitee1');
  assert.eq(elig.receiveFriend, true, '亲友被用于收礼记录后应成立');
  const r2 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r2.granted, true, '亲友被用于记录后应发放');
});

test('邀请奖励：重复评估幂等，不重复发放', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  await actReceive(db, 'invitee1');
  const r1 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r1.granted, true, '首次应发放');
  const r2 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r2.granted, true, '重复评估应返回已发放');
  assert.eq(r2.alreadyGranted, true, '应标记 alreadyGranted');
  const r3 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r3.alreadyGranted, true, '第三次仍幂等');
  assert.eq((await grantsOf(db, 'inviter1')).length, 1, '发放记录仍只能有1条');
  const q = await effQuota(db, 'inviter1');
  assert.eq(q.receivePool, 10, '池仍为10，没有重复累加');
});

test('邀请奖励：自己邀请自己拒绝且不落绑定', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'solo1');
  const code = await IR.getOrCreateInviteCode(db, 'solo1');
  const err = await expectInviteErr(IR.bindInvite(db, 'solo1', { code }), 'invite-self');
  assert(/自己/.test(err.message), '拒绝文案应用户可读');
  const n = await db.collection(COLLECTIONS.InviteBinding).count({ inviteeId: 'solo1' });
  assert.eq(n, 0, '自邀不应落绑定记录');
});

test('邀请奖励：无效邀请码拒绝', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'invitee1');
  await expectInviteErr(IR.bindInvite(db, 'invitee1', { code: 'ZZZZZZZZ' }), 'invite-code-invalid');
  const n = await db.collection(COLLECTIONS.InviteBinding).count({ inviteeId: 'invitee1' });
  assert.eq(n, 0, '无效码不应落绑定记录');
});

test('邀请奖励：同一被邀请人重复绑定拒绝', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviterA', 'invitee1');
  await h.newUser(db, 'inviterB');
  const codeB = await IR.getOrCreateInviteCode(db, 'inviterB');
  await expectInviteErr(IR.bindInvite(db, 'invitee1', { code: codeB }), 'invite-already-bound');
  const bindings = await db.collection(COLLECTIONS.InviteBinding).find({ inviteeId: 'invitee1' });
  assert.eq(bindings.length, 1, '绑定仍只有1条');
  assert.eq(bindings[0].inviterId, 'inviterA', '绑定关系未被改绑');
});

test('邀请奖励：非新用户（已有记录）拒绝绑定', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'inviter1');
  await h.newUser(db, 'olduser1');
  await actGift(db, 'olduser1'); // 已有送礼记录 = 已在用账本
  const code = await IR.getOrCreateInviteCode(db, 'inviter1');
  await expectInviteErr(IR.bindInvite(db, 'olduser1', { code }), 'invite-not-new-user');
  const n = await db.collection(COLLECTIONS.InviteBinding).count({ inviteeId: 'olduser1' });
  assert.eq(n, 0, '非新用户不应落绑定记录');
});

test('邀请奖励：同设备重复领取拒绝', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1', 'device-X');
  await actReceive(db, 'invitee1');
  const r1 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r1.granted, true, '第一台设备首次领取应成功');
  // 同一设备、另一个新用户、另一个邀请人：完成条件后应被设备规则拦下
  await setupBound(db, 'inviter2', 'invitee2', 'device-X');
  await actGift(db, 'invitee2');
  const r2 = await IR.evaluateInvite(db, 'invitee2');
  assert.eq(r2.granted, false, '同设备重复领取应拒绝');
  assert.eq(r2.reason, 'invite-device-duplicate', '原因应为设备重复');
  const b2 = await db.collection(COLLECTIONS.InviteBinding).findOne({ inviteeId: 'invitee2' });
  assert.eq(b2.status, 'blocked', '重复设备的绑定应被标记 blocked');
  const r3 = await IR.evaluateInvite(db, 'invitee2');
  assert.eq(r3.granted, false, 'blocked 后重复评估仍拒绝');
  assert.eq((await grantsOf(db, 'inviter2')).length, 0, '第二个邀请人不应有发放记录');
});

test('邀请奖励：达到上限不再发放，管理员改上限后生效', async () => {
  const db = await h.newDB();
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
  // 非管理员改设置 → 拒绝（not-admin），且不落库
  const err = await expectInviteErr(
    core.admin.updateInviteSettings(db, 'random_user', { maxSuccessfulInvites: 1 }),
    'not-admin'
  );
  assert(/无权限/.test(err.message), '非管理员拒绝文案应用户可读');
  const before = await core.quota.resolveInviteSettings(db);
  assert.eq(before.maxSuccessfulInvites, 10, '非管理员拒绝后上限未变');
  // 管理员把上限改成 1
  const set = await core.admin.updateInviteSettings(db, BOSS, { maxSuccessfulInvites: 1 });
  assert.eq(set.inviteReward.maxSuccessfulInvites, 1, '上限应改为1');
  const cfgAudits = await db.collection(COLLECTIONS.AuditLog).find({ action: 'config', targetId: 'inviteReward' });
  assert.eq(cfgAudits.length, 1, '改设置应写1条配置审计');
  const cfg = await core.admin.getConfig(db, BOSS);
  assert.eq(cfg.inviteReward.maxSuccessfulInvites, 1, 'getConfig 应读到新生效上限');

  await h.newUser(db, 'inviter1');
  const code = await IR.getOrCreateInviteCode(db, 'inviter1');
  await h.newUser(db, 'invitee1');
  await IR.bindInvite(db, 'invitee1', { code });
  await actReceive(db, 'invitee1');
  const r1 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r1.granted, true, '上限内第1次应发放');
  await h.newUser(db, 'invitee2');
  await IR.bindInvite(db, 'invitee2', { code });
  await actGift(db, 'invitee2');
  const r2 = await IR.evaluateInvite(db, 'invitee2');
  assert.eq(r2.granted, false, '达到上限后不应发放');
  assert.eq(r2.reason, 'invite-cap-reached', '原因应为已达上限');
  assert.eq((await grantsOf(db, 'inviter1')).length, 1, '发放记录仍为1条');
  // 管理员把上限 raised 到 2 后，同一绑定重新评估即可发放
  await core.admin.updateInviteSettings(db, BOSS, { maxSuccessfulInvites: 2 });
  const r3 = await IR.evaluateInvite(db, 'invitee2');
  assert.eq(r3.granted, true, '上限提高后应补发');
  assert.eq((await grantsOf(db, 'inviter1')).length, 2, '发放记录应变为2条');
});

test('邀请奖励：额度池可累积，超额记录从池消耗（现行规则）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'inviter1');
  const code = await IR.getOrCreateInviteCode(db, 'inviter1');
  for (const id of ['invitee1', 'invitee2']) {
    await h.newUser(db, id);
    await IR.bindInvite(db, id, { code });
    await actReceive(db, id);
    const r = await IR.evaluateInvite(db, id);
    assert.eq(r.granted, true, `${id} 应发放`);
  }
  const q = await effQuota(db, 'inviter1');
  assert.eq(q.receivePool, 20, '两次成功邀请池应累积到20');
  assert.eq(q.giftRecords, 40, '送礼额度应为30+5+5=40');
  // 邀请人自己的礼薄写满 30 条后，再写 20 条从池消耗，第 51 条被拒
  const c = await core.contacts.createContact(db, 'inviter1', 'inviter1', { name: '亲友甲' });
  const ev = await core.receive.createEvent(db, 'inviter1', 'inviter1', { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  for (let i = 0; i < 50; i++) {
    await core.receive.createRecord(db, 'inviter1', 'inviter1', ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  }
  let err = null;
  try {
    await core.receive.createRecord(db, 'inviter1', 'inviter1', ev._id, { contactId: c._id, amount: 100, type: '现金', date: '2026-10-01' });
  } catch (e) { err = e; }
  assert(err && err.code && err.code.startsWith('quota-exceeded'), '第51条应被额度拦截，code=' + (err && err.code));
  const cnt = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId: 'inviter1', eventId: ev._id });
  assert.eq(cnt, 50, '拒绝后数据未变：仍为50条');
});

test('邀请奖励：会员过期用户奖励仍按池规则（与会员额度互不影响）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'inviter1', { status: 'member', expireAt: Date.now() - 40 * 86400e3, graceUntil: null });
  const inviterDoc = await db.collection(COLLECTIONS.User).findOne({ _id: 'inviter1' });
  assert.eq(core.quota.getMembershipState(inviterDoc), 'expired', '邀请人应为会员已过期状态');
  await h.newUser(db, 'invitee1');
  const code = await IR.getOrCreateInviteCode(db, 'inviter1');
  await IR.bindInvite(db, 'invitee1', { code });
  await actGift(db, 'invitee1');
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, true, '邀请人会员过期不影响奖励发放');
  const q = await effQuota(db, 'inviter1');
  assert.eq(q.receivePool, 10, '过期会员奖励池仍为10');
  assert.eq(q.giftRecords, 35, '送礼额度应为免费30+奖励5（无会员加成）');
});

test('邀请奖励：每次发放写审计，奖励记录可在我的页查，老板平台统计一致', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  await actReceive(db, 'invitee1');
  await IR.evaluateInvite(db, 'invitee1');
  const audits = await db.collection(COLLECTIONS.AuditLog).find({ action: 'grant', targetType: 'inviteReward' });
  assert.eq(audits.length, 1, '发放应写1条审计');
  assert.eq(audits[0].ownerId, 'inviter1', '审计归属邀请人');
  const s = await IR.getMyInviteSummary(db, 'inviter1');
  assert.eq(s.successfulInvites, 1, '汇总成功邀请数应为1');
  assert.eq(s.maxSuccessfulInvites, 10, '汇总上限应为10');
  assert.eq(s.remainingInvites, 9, '汇总剩余应为9');
  assert.eq(s.poolEarned, 10, '汇总已得收礼池应为10');
  assert.eq(s.giftsEarned, 5, '汇总已得送礼应为5');
  assert.eq(s.records.length, 1, '汇总记录应有1条');
  assert.eq(s.records[0].status, 'granted', '记录状态应为已发放');
  assert.eq(s.records[0].poolGranted, 10, '记录金额应为池+10');
  assert(!/invitee1$/.test(s.records[0].inviteeId) || s.records[0].inviteeId.includes('***'), '记录里的被邀请人应脱敏');
  const stats = await core.admin.inviteStats(db);
  assert.eq(stats.totalInvites, 1, '老板平台成功邀请总数应为1');
  assert.eq(stats.totalPoolGranted, 10, '老板平台已发收礼池应为10');
  assert.eq(stats.totalGiftsGranted, 5, '老板平台已发放送礼应为5');
  assert.eq(stats.inviterCount, 1, '老板平台邀请人数应为1');
});

test('邀请奖励：被邀请人注销后重注册不重复计', async () => {
  const db = await h.newDB();
  await setupBound(db, 'inviter1', 'invitee1');
  await actReceive(db, 'invitee1');
  await IR.evaluateInvite(db, 'invitee1');
  await core.account.purgeUserOnCancellation(db, 'invitee1');
  assert.eq((await grantsOf(db, 'inviter1')).length, 1, '注销后发放历史应保留');
  // 同一 openid 重新注册，换任何邀请人的码都不能再绑
  await h.newUser(db, 'invitee1');
  await h.newUser(db, 'inviter2');
  const code2 = await IR.getOrCreateInviteCode(db, 'inviter2');
  await expectInviteErr(IR.bindInvite(db, 'invitee1', { code: code2 }), 'invite-already-bound');
  assert.eq((await grantsOf(db, 'inviter2')).length, 0, '不应为重注册用户重复发放');
});

test('邀请奖励：开关关闭时拒绝绑定且不发放（老板平台覆盖）', async () => {
  const db = await h.newDB();
  await db.collection(COLLECTIONS.AppConfig).insert({
    _id: 'singleton',
    inviteReward: { enabled: false, perInvite: { receivePool: 10, giftRecords: 5 }, maxSuccessfulInvites: 10 },
  });
  await h.newUser(db, 'inviter1');
  await h.newUser(db, 'invitee1');
  const code = await IR.getOrCreateInviteCode(db, 'inviter1');
  const err = await expectInviteErr(IR.bindInvite(db, 'invitee1', { code }), 'invite-disabled');
  assert(/暂未开启/.test(err.message), '关闭时文案应用户可读');
  // 已有绑定在关停期间完成动作也不发放；重新开启后可发放
  await db.collection(COLLECTIONS.AppConfig).update({ _id: 'singleton' }, {
    inviteReward: { enabled: true, perInvite: { receivePool: 10, giftRecords: 5 }, maxSuccessfulInvites: 10 },
  });
  await IR.bindInvite(db, 'invitee1', { code });
  await actGift(db, 'invitee1');
  await db.collection(COLLECTIONS.AppConfig).update({ _id: 'singleton' }, {
    inviteReward: { enabled: false, perInvite: { receivePool: 10, giftRecords: 5 }, maxSuccessfulInvites: 10 },
  });
  const r1 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r1.granted, false, '关停期间不应发放');
  assert.eq(r1.reason, 'invite-disabled', '原因应为活动未开启');
  await db.collection(COLLECTIONS.AppConfig).update({ _id: 'singleton' }, {
    inviteReward: { enabled: true, perInvite: { receivePool: 10, giftRecords: 5 }, maxSuccessfulInvites: 10 },
  });
  const r2 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r2.granted, true, '重新开启后应发放');
});

test('邀请奖励：邀请码稳定唯一，汇总含上限进度', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'userA');
  await h.newUser(db, 'userB');
  const a1 = await IR.getOrCreateInviteCode(db, 'userA');
  const a2 = await IR.getOrCreateInviteCode(db, 'userA');
  assert.eq(a1, a2, '同一用户邀请码应稳定');
  const b1 = await IR.getOrCreateInviteCode(db, 'userB');
  assert(a1 !== b1, '不同用户邀请码应不同');
  const s = await IR.getMyInviteSummary(db, 'userA');
  assert.eq(s.inviteCode, a1, '汇总应带我的邀请码');
  assert.eq(s.enabled, true, '汇总开关应为开启');
  assert.eq(s.successfulInvites, 0, '尚无成功邀请');
  assert.eq(s.remainingInvites, 10, '剩余应为上限10');
  assert.eq(s.perInvite.receivePool, 10, '汇总每邀请收礼池应为10');
});
