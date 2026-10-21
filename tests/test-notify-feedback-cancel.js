/** 通知中心 + 意见反馈 + 注销全流程测试（任务L）
 * 高风险点单独覆盖：
 * - 通知隔离：列表/未读/标已读一律按接收人隔离，他人不可见、标不动；
 * - 触发点：邀请奖励发放、共享接受/改权/移除、会员三提醒各产生且只产生一条；
 * - 反馈：必填与字数上限校验、落库字段与老板平台口径对齐（pending/handled、脱敏）；
 * - 注销：开关关闭拒绝、冷静期重复申请拒绝、撤销恢复、期满执行的数据清理
 *   与联动（共享解除/成员身份移除/邀请防刷记录保留）。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const N = core.notify;
const FB = core.feedback;
const AC = core.account;
const IR = core.inviteReward;

const DAY = 86400e3;
const CANCEL_ON = { ...core.config, accountCancellation: { enabled: true, coolingOffDays: 7 } };

async function expectErr(promise, codeOrText) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `应抛错 ${codeOrText} 但成功了`);
  if (codeOrText) {
    assert(
      err.code === codeOrText || String(err.message).includes(codeOrText),
      `错误应为 ${codeOrText}，实际 code=${err.code} msg=${err.message}`
    );
  }
  return err;
}

// ———————————————————— 通知：基本读写与隔离 ————————————————————

test('通知：写入字段完整，列表只见自己的', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await h.newUser(db, 'u2');
  const r = await N.notify(db, 'u1', 'shareChanged', { action: 'grantUpdated' });
  assert.eq(r.created, true, '应新建');
  const n = r.notification;
  assert.eq(n.userId, 'u1', '接收人');
  assert.eq(n.type, 'shareChanged', '类型');
  assert(n.title && n.body, '标题正文齐全');
  assert.eq(n.read, false, '默认未读');
  assert(n.createdAt > 0, '有创建时间');
  const mine = await N.listNotifications(db, 'u1');
  assert.eq(mine.length, 1, '本人见 1 条');
  const theirs = await N.listNotifications(db, 'u2');
  assert.eq(theirs.length, 0, '他人不可见');
});

test('通知：未读计数、标已读、全部已读；他人标不动', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await h.newUser(db, 'u2');
  const a = await N.notify(db, 'u1', 'shareChanged', {});
  await N.notify(db, 'u1', 'shareChanged', { action: 'inviteAccepted' });
  assert.eq(await N.unreadCount(db, 'u1'), 2, '未读应为 2');
  // 他人尝试标已读：不得生效
  const bad = await N.markRead(db, 'u2', a.notification._id);
  assert.eq(bad.ok, false, '他人标已读应失败');
  assert.eq(await N.unreadCount(db, 'u1'), 2, '他人标不动，未读不变');
  const ok = await N.markRead(db, 'u1', a.notification._id);
  assert.eq(ok.ok, true, '本人标已读成功');
  assert.eq(await N.unreadCount(db, 'u1'), 1, '未读剩 1');
  await N.markAllRead(db, 'u1');
  assert.eq(await N.unreadCount(db, 'u1'), 0, '全部已读后为 0');
});

test('通知：未知类型拒绝；dedupeKey 幂等不重复发', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await expectErr(N.notify(db, 'u1', 'nopeType', {}), '未知通知类型');
  const p = { poolGranted: 10, giftsGranted: 5, dedupeKey: 'inviteRewardGranted:g1' };
  const r1 = await N.notify(db, 'u1', 'inviteRewardGranted', p);
  const r2 = await N.notify(db, 'u1', 'inviteRewardGranted', p);
  assert.eq(r1.created, true, '第一次新建');
  assert.eq(r2.created, false, '同键第二次不新建');
  assert.eq((await N.listNotifications(db, 'u1')).length, 1, '只有一条');
});

// ———————————————————— 通知触发点：邀请奖励到账 ————————————————————

test('通知触发：邀请奖励发放后邀请人收到一条到账通知（重复评估不再发）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'inviter1');
  await h.newUser(db, 'invitee1');
  const code = await IR.getOrCreateInviteCode(db, 'inviter1');
  await IR.bindInvite(db, 'invitee1', { code });
  const c = await core.contacts.createContact(db, 'invitee1', 'invitee1', { name: '亲友甲' });
  await core.gifts.createGift(db, 'invitee1', 'invitee1', { contactId: c._id, tagId: 'shengri', amount: 5000, date: '2026-10-01' });
  const r = await IR.evaluateInvite(db, 'invitee1');
  assert.eq(r.granted, true, '应发放');
  const list = await N.listNotifications(db, 'inviter1');
  const grants = list.filter((n) => n.type === 'inviteRewardGranted');
  assert.eq(grants.length, 1, '到账通知恰好一条');
  assert(grants[0].body.includes('+10') && grants[0].body.includes('+5'), '通知正文含 +10/+5');
  await IR.evaluateInvite(db, 'invitee1'); // 幂等再评估
  const again = (await N.listNotifications(db, 'inviter1')).filter((n) => n.type === 'inviteRewardGranted');
  assert.eq(again.length, 1, '重复评估不重复通知');
  assert.eq((await N.listNotifications(db, 'invitee1')).length, 0, '被邀请人不收此通知');
});

// ———————————————————— 通知触发点：家庭共享变更 ————————————————————

test('通知触发：共享接受通知主人、改权通知成员、移除再通知成员', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev] } });
  // 发出邀请阶段不产生通知
  assert.eq((await N.listNotifications(db, owner)).length, 0, '发出邀请不通知');
  await core.share.accept(db, inv.membershipId, member);
  const ownerNotes = await N.listNotifications(db, owner);
  assert.eq(ownerNotes.length, 1, '主人收到 1 条');
  assert.eq(ownerNotes[0].type, 'shareChanged', '类型为共享变更');
  assert(ownerNotes[0].body.includes('接受了你的共享邀请'), '正文为加入口径');
  await core.share.updateGrant(db, owner, inv.membershipId, { switches: { view: true, add: true } });
  const mNotes = await N.listNotifications(db, member);
  assert.eq(mNotes.length, 1, '成员收到改权通知 1 条');
  assert(mNotes[0].body.includes('调整了共享给你'), '正文为改权口径');
  await core.share.removeMember(db, owner, inv.membershipId);
  const mNotes2 = await N.listNotifications(db, member);
  assert.eq(mNotes2.length, 2, '成员再收到移除通知');
  assert(mNotes2.some((n) => n.body.includes('移出')), '含移除口径正文');
});

// ———————————————————— 通知触发点：会员三提醒 ————————————————————

test('通知触发：会员三提醒按时间点各发一次且去重', async () => {
  const db = await h.newDB();
  const t0 = Date.now();
  // 无到期日的免费用户：不发
  await h.newUser(db, 'free1');
  let r = await N.checkMembershipReminders(db, 'free1', t0);
  assert.eq(r.fired.length, 0, '免费用户不发提醒');
  // 到期前 10 天：只发"到期前15天"一条（其判定点已过）
  await h.newUser(db, 'm1', { status: 'member', expireAt: t0 + 10 * DAY, graceUntil: null });
  r = await N.checkMembershipReminders(db, 'm1', t0);
  assert.eq(JSON.stringify(r.fired), JSON.stringify(['membershipExpiring']), '只发到期前提醒');
  r = await N.checkMembershipReminders(db, 'm1', t0);
  assert.eq(r.fired.length, 0, '重复判定不再发');
  assert.eq((await N.listNotifications(db, 'm1')).length, 1, '共 1 条');
  // 已过期 29 天（缓冲期还剩 1 天）：三个时间点全过 → 三条齐发
  await h.newUser(db, 'm2', { status: 'member', expireAt: t0 - 29 * DAY, graceUntil: null });
  r = await N.checkMembershipReminders(db, 'm2', t0);
  assert.eq(r.fired.length, 3, '三提醒齐发');
  const types = (await N.listNotifications(db, 'm2')).map((n) => n.type).sort();
  assert.eq(JSON.stringify(types), JSON.stringify(['graceEnding', 'membershipExpired', 'membershipExpiring']), '三类型齐全');
});

// ———————————————————— 反馈 ————————————————————

test('反馈：提交落库字段与老板平台口径一致，我的列表隔离', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await h.newUser(db, 'u2');
  const { feedbackId } = await FB.submitFeedback(db, 'u1', {
    content: '  横置礼单本很好看，就是字有点小  ',
    images: ['a.png', 'b.png', 'c.png', 'd.png'],
  });
  assert(feedbackId, '返回反馈 id');
  const rows = await db.collection(COLLECTIONS.Feedback).find({ _id: feedbackId });
  assert.eq(rows.length, 1, '落库一条');
  const f = rows[0];
  assert.eq(f.userId, 'u1', '提交人');
  assert.eq(f.content, '横置礼单本很好看，就是字有点小', '正文去首尾空格');
  assert.eq(f.images.length, 3, '截图最多 3 张');
  assert.eq(f.status, 'pending', '初始状态待处理');
  assert(f.createdAt > 0, '有时间');
  assert.eq((await FB.listMyFeedback(db, 'u1')).length, 1, '本人可见');
  assert.eq((await FB.listMyFeedback(db, 'u2')).length, 0, '他人不可见');
});

test('反馈：必填校验与字数上限', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await expectErr(FB.submitFeedback(db, 'u1', { content: '' }), '不能为空');
  await expectErr(FB.submitFeedback(db, 'u1', { content: '   ' }), '不能为空');
  await expectErr(FB.submitFeedback(db, 'u1', {}), '不能为空');
  const max = FB.maxLength(core.config);
  await expectErr(FB.submitFeedback(db, 'u1', { content: '字'.repeat(max + 1) }), '最多');
  const ok = await FB.submitFeedback(db, 'u1', { content: '字'.repeat(max) });
  assert(ok.feedbackId, '恰好上限可提交');
  // 自定义上限生效
  const cfg = { ...core.config, feedback: { maxLength: 10 } };
  await expectErr(FB.submitFeedback(db, 'u1', { content: '一二三四五六七八九十一' }, cfg), '最多 10 字');
  assert.eq((await FB.listMyFeedback(db, 'u1')).length, 1, '失败的不落库');
});

test('反馈：老板平台列表脱敏与处理状态切换', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'openid_long_user_1');
  const { feedbackId } = await FB.submitFeedback(db, 'openid_long_user_1', { content: '希望加个搜索' });
  const page = await FB.listFeedbackForAdmin(db, {});
  assert.eq(page.total, 1, '总数');
  assert(page.items[0].userId !== 'openid_long_user_1', 'userId 已脱敏');
  assert(page.items[0].userId.includes('*'), '脱敏含星号');
  assert.eq(page.items[0].content, '希望加个搜索', '正文可见');
  const sw = await FB.setFeedbackStatus(db, feedbackId, 'handled');
  assert.eq(sw.ok, true, '可标记已处理');
  const pendingOnly = await FB.listFeedbackForAdmin(db, { status: 'pending' });
  assert.eq(pendingOnly.total, 0, '按状态过滤');
});

// ———————————————————— 注销全流程 ————————————————————

test('注销：开关关闭时申请被拒（现行行为保持）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  const err = await expectErr(AC.requestCancellation(db, 'u1'), 'cancel-disabled');
  assert(err.message.includes('暂未开放'), '文案为暂未开放');
  const st = await AC.getCancellationStatus(db, 'u1');
  assert.eq(st.status, 'none', '状态不变');
  assert.eq(st.enabled, false, '开关为关');
});

test('注销：申请进入冷静期，重复申请被拒，他人互不影响', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await h.newUser(db, 'u2');
  const t0 = Date.now();
  const r = await AC.requestCancellation(db, 'u1', CANCEL_ON, t0);
  assert.eq(r.status, 'pendingCancel', '进入冷静期');
  assert.eq(r.cancelAt, t0 + 7 * DAY, '执行日 = 申请 + 7 天冷静期');
  assert.eq(r.coolingOffDays, 7, '冷静期天数来自配置');
  const st = await AC.getCancellationStatus(db, 'u1', CANCEL_ON, t0);
  assert.eq(st.status, 'pendingCancel', '状态回显');
  assert.eq(st.remainingDays, 7, '剩余 7 天');
  await expectErr(AC.requestCancellation(db, 'u1', CANCEL_ON, t0), 'cancel-already-pending');
  // u2 的申请/撤销只作用于 u2 自己，u1 不受影响（无"替别人申请"通道）
  await AC.requestCancellation(db, 'u2', CANCEL_ON, t0);
  await AC.revokeCancellation(db, 'u2');
  assert.eq((await AC.getCancellationStatus(db, 'u2', CANCEL_ON, t0)).status, 'none', 'u2 已撤销');
  assert.eq((await AC.getCancellationStatus(db, 'u1', CANCEL_ON, t0)).status, 'pendingCancel', 'u1 不受影响');
});

test('注销：冷静期内撤销恢复，可重新申请；无申请时撤销被拒', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await expectErr(AC.revokeCancellation(db, 'u1'), 'cancel-not-pending');
  await AC.requestCancellation(db, 'u1', CANCEL_ON);
  const rv = await AC.revokeCancellation(db, 'u1');
  assert.eq(rv.ok, true, '撤销成功');
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: 'u1' });
  assert(!user.cancelStatus && !user.cancelAt, '待注销字段已清');
  const r2 = await AC.requestCancellation(db, 'u1', CANCEL_ON);
  assert.eq(r2.status, 'pendingCancel', '撤销后可重新申请');
});

test('注销：期满执行——本人数据清、共享联动解除、邀请防刷记录保留', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, { events: [ev] });
  // member 自己的数据（执行后应保留：执行的是 owner 的注销）
  const mc = await core.contacts.createContact(db, member, member, { name: '成员亲友' });
  assert(mc._id, '成员自有联系人');
  // owner 作为邀请人已有一笔发放（防刷记录应保留）
  await h.newUser(db, 'invitee9');
  const code = await IR.getOrCreateInviteCode(db, owner);
  await IR.bindInvite(db, 'invitee9', { code });
  const ic = await core.contacts.createContact(db, 'invitee9', 'invitee9', { name: '新朋友' });
  await core.gifts.createGift(db, 'invitee9', 'invitee9', { contactId: ic._id, tagId: 'shengri', amount: 5000, date: '2026-10-01' });
  const gr = await IR.evaluateInvite(db, 'invitee9');
  assert.eq(gr.granted, true, '预置发放成功');
  // owner 的通知与反馈（应随注销删除）
  assert((await N.listNotifications(db, owner)).length >= 1, '预置通知存在');
  await FB.submitFeedback(db, owner, { content: '注销前反馈' });

  const t0 = Date.now();
  await AC.requestCancellation(db, owner, CANCEL_ON, t0);
  // 未到期：不执行、数据不动
  let r = await AC.executeCancellationIfDue(db, owner, CANCEL_ON, t0 + 6 * DAY);
  assert.eq(r.executed, false, '未到期不执行');
  assert((await db.collection(COLLECTIONS.Contact).count({ ownerId: owner })) > 0, '数据还在');
  // 到期执行
  r = await AC.executeCancellationIfDue(db, owner, CANCEL_ON, t0 + 7 * DAY);
  assert.eq(r.executed, true, '到期执行');
  assert.eq(await db.collection(COLLECTIONS.User).count({ _id: owner }), 0, '用户本体删除（邀请码随之停用）');
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: owner }), 0, '亲友清空');
  assert.eq(await db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId: owner }), 0, '礼薄清空');
  assert.eq(await db.collection(COLLECTIONS.GiftRecord).count({ ownerId: owner }), 0, '送礼清空');
  assert.eq(await db.collection(COLLECTIONS.ShareMembership).count({ ownerId: owner }), 0, '作为主人的共享关系解除');
  const grantsLeft = await db.collection(COLLECTIONS.ShareGrant).find({});
  assert.eq(grantsLeft.length, 0, '授权单一并删除');
  assert.eq(await db.collection(COLLECTIONS.Notification).count({ userId: owner }), 0, '通知删除');
  assert.eq(await db.collection(COLLECTIONS.Feedback).count({ userId: owner }), 0, '反馈删除');
  // 防刷保留口径：绑定与发放记录不删
  assert.eq(await db.collection(COLLECTIONS.InviteBinding).count({ inviterId: owner }), 1, '邀请绑定保留');
  assert.eq(await db.collection(COLLECTIONS.InviteRewardGrant).count({ userId: owner }), 1, '发放记录保留');
  // 成员自有数据不受影响
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: member }), 1, '成员数据保留');
  // 再执行一次：用户已不存在，安全返回未执行
  r = await AC.executeCancellationIfDue(db, owner, CANCEL_ON, t0 + 8 * DAY);
  assert.eq(r.executed, false, '重复执行安全');
});

test('注销：作为成员期满执行——成员身份移除、主人数据不动', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member, membershipId } = await h.setupMember(db, owner, { events: [ev] });
  await core.contacts.createContact(db, member, member, { name: '成员亲友' });
  const t0 = Date.now();
  await AC.requestCancellation(db, member, CANCEL_ON, t0);
  const r = await AC.executeCancellationIfDue(db, member, CANCEL_ON, t0 + 7 * DAY);
  assert.eq(r.executed, true, '执行');
  assert.eq(await db.collection(COLLECTIONS.ShareMembership).count({ _id: membershipId }), 0, '成员行移除');
  assert.eq(await db.collection(COLLECTIONS.ShareGrant).count({ membershipId }), 0, '对应授权单移除');
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: member }), 0, '成员本人数据清空');
  assert((await db.collection(COLLECTIONS.Contact).count({ ownerId: owner })) > 0, '主人数据不动');
  assert.eq(await db.collection(COLLECTIONS.User).count({ _id: owner }), 1, '主人账号不动');
});
