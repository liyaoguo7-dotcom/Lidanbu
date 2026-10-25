/** 邀请奖励「按老板平台配置」端到端验证（2026-10-25 用户要求坐实）
 * 背景：真机上邀请奖励设置页已能保存，但「设了到底算不算数」没验过。
 * 本文件全程走真实链路：管理员经 core.admin 改设置（非默认数字）→
 * 被邀请人绑定并完成有效动作 → 评估发放 → 断言发放额、额度生效、
 * 上限拦截、发放记录与审计留痕全部按配置走，不是写死数字。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const IR = core.inviteReward;

const BOSS = 'boss_inv';

test('邀请奖励端到端：发放额/额度/上限全部按后台配置（7/3/上限1）', async () => {
  const db = await h.newDB();
  await db.collection(COLLECTIONS.AppConfig).insert({ _id: 'singleton', adminIds: [BOSS] });
  await h.newUser(db, BOSS);
  // 老板在后台把奖励改成非默认数字：每邀请 +7 收礼池 / +3 送礼、上限 1 人
  await core.admin.updateInviteSettings(db, BOSS, {
    enabled: true, perInvite: { receivePool: 7, giftRecords: 3 }, maxSuccessfulInvites: 1,
  });

  // 邀请人与第一位被邀请人：绑定 → 建亲友+礼薄+收礼记录（有效动作）
  await h.newUser(db, 'inviter');
  await h.newUser(db, 'invitee1');
  const code = await IR.getOrCreateInviteCode(db, 'inviter');
  await IR.bindInvite(db, 'invitee1', { code });
  const c1 = await core.contacts.createContact(db, 'invitee1', 'invitee1', { name: '亲友甲' });
  const ev = await core.receive.createEvent(db, 'invitee1', 'invitee1', { name: '婚宴', tagId: 'jiehun', date: '2026-10-01' });
  await core.receive.createRecord(db, 'invitee1', 'invitee1', ev._id, { contactId: c1._id, amount: 10000, type: '现金', date: '2026-10-01' });

  const r1 = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r1.granted, true, '条件完成应发放');
  assert.eq(r1.poolGranted, 7, '收礼池应按配置发 7（不是默认 10）');
  assert.eq(r1.giftsGranted, 3, '送礼应按配置发 3（不是默认 5）');

  // 发放记录落库的也是配置数字
  const grants = await db.collection(COLLECTIONS.InviteRewardGrant).find({ userId: 'inviter' });
  assert.eq(grants.length, 1, '应有一条发放记录');
  assert.eq(grants[0].poolGranted, 7, '发放记录·收礼池 7');
  assert.eq(grants[0].giftsGranted, 3, '发放记录·送礼 3');

  // 邀请人实际额度按配置生效：池 7、送礼 = 免费 50 + 3
  const inviter = await db.collection(COLLECTIONS.User).findOne({ _id: 'inviter' });
  const settings = await core.quota.resolveInviteSettings(db);
  const q = core.quota.getEffectiveQuota(inviter, core.config, Date.now(), { successfulInvites: 1, settings });
  assert.eq(q.receivePool, 7, '邀请人收礼池应为配置的 7');
  assert.eq(q.giftRecords, 53, '邀请人送礼额度应为 50+3');

  // 审计留痕可查（老板平台操作记录同源）
  const audits = await db.collection(COLLECTIONS.AuditLog).find({ action: 'grant', targetType: 'inviteReward' });
  assert.eq(audits.length, 1, '发放应有一条审计记录');
  assert(audits[0].detail.includes('+7'), '审计摘要应含配置数字 +7');

  // 第二位被邀请人完成送礼动作：上限 1 已满，不再发放
  await h.newUser(db, 'invitee2');
  await IR.bindInvite(db, 'invitee2', { code });
  const c2 = await core.contacts.createContact(db, 'invitee2', 'invitee2', { name: '亲友乙' });
  await core.gifts.createGift(db, 'invitee2', 'invitee2', { contactId: c2._id, tagId: 'shengri', amount: 5000, date: '2026-10-01' });
  const r2 = await IR.evaluateInvite(db, 'invitee2');
  assert.eq(r2.granted, false, '超过配置上限不应发放');
  assert.eq(r2.reason, 'invite-cap-reached', '原因应为达到上限');
  assert.eq((await db.collection(COLLECTIONS.InviteRewardGrant).find({ userId: 'inviter' })).length, 1, '发放记录仍只有一条');
});
