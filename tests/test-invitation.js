/** 电子请柬测试（阶段4）
 * 覆盖：建/改/删与字段校验、owner 权限、回执提交与重复提交更新、
 * 统计合计、一键加亲友（正规路径+重名提醒）、删除连带回执。
 * 建请柬是基础功能：不查会员、不限额度（免费用户直接建）。
 */
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const INV = core.invitation;

const FIELDS = {
  type: 'wedding', title: '张三与李四的婚礼', eventDate: '2026-11-08', eventTime: '11:58',
  address: '义乌幸福大酒店三楼宴会厅', hostName: '张三', blessing: '诚邀光临', styleId: 'guochao',
};

async function expectErr(promise, match) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `应抛错 ${match} 但成功了`);
  if (match) assert(String(err.code || err.message).includes(match), `错误应含 ${match}，实际 ${err.code || err.message}`);
  return err;
}

test('请柬：免费用户可建请柬，字段落库且带默认值', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'free1'); // 免费用户，无会员
  const inv = await INV.createInvitation(db, 'free1', { ...FIELDS });
  assert(inv._id, '应返回 _id');
  const saved = await INV.getInvitation(db, inv._id);
  assert.eq(saved.title, FIELDS.title, '标题');
  assert.eq(saved.type, 'wedding', '类型');
  assert.eq(saved.styleId, 'guochao', '风格');
  assert.eq(saved.mapLoc, null, 'mapLoc 缺省 null');
  assert.eq(saved.ownerId, 'free1', 'ownerId');
  // 不填可选字段也能建
  const inv2 = await INV.createInvitation(db, 'free1', { title: '乔迁之喜', eventDate: '2026-12-01', hostName: '李四' });
  assert.eq(inv2.type, 'wedding', '类型缺省 wedding');
  assert.eq(inv2.styleId, 'guochao', '风格缺省 guochao');
});

test('请柬：字段校验（标题/日期/主人名/类型必填，非法风格回落）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  await expectErr(INV.createInvitation(db, 'u1', { ...FIELDS, title: '  ' }), '标题不能为空');
  await expectErr(INV.createInvitation(db, 'u1', { ...FIELDS, eventDate: '' }), '活动日期');
  await expectErr(INV.createInvitation(db, 'u1', { ...FIELDS, eventDate: '2026/11/08' }), '活动日期');
  await expectErr(INV.createInvitation(db, 'u1', { ...FIELDS, hostName: '' }), '主人姓名');
  await expectErr(INV.createInvitation(db, 'u1', { ...FIELDS, type: 'party' }), '类型不正确');
  const inv = await INV.createInvitation(db, 'u1', { ...FIELDS, styleId: '不存在的风格' });
  assert.eq(inv.styleId, 'guochao', '非法 styleId 回落 guochao 不阻断');
});

test('请柬：主人可改，白名单外字段不写入', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'u1');
  const inv = await INV.createInvitation(db, 'u1', { ...FIELDS });
  const updated = await INV.updateInvitation(db, 'u1', inv._id, {
    title: '改后的标题', styleId: 'french', ownerId: '别人', hacked: 1,
  });
  assert.eq(updated.title, '改后的标题', '标题已改');
  assert.eq(updated.styleId, 'french', '风格已改');
  const saved = await INV.getInvitation(db, inv._id);
  assert.eq(saved.ownerId, 'u1', 'ownerId 不可被 patch 改掉');
  assert.eq(saved.hacked, undefined, '白名单外字段不落库');
});

test('请柬：他人不可改、不可删、不可看回执统计（owner 校验）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  await h.newUser(db, 'other1');
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  await expectErr(INV.updateInvitation(db, 'other1', inv._id, { title: 'x' }), 'invitation-not-owner');
  await expectErr(INV.deleteInvitation(db, 'other1', inv._id), 'invitation-not-owner');
  await expectErr(INV.getRsvpStats(db, 'other1', inv._id), 'invitation-not-owner');
  await expectErr(INV.listRsvps(db, 'other1', inv._id), 'invitation-not-owner');
  // 请柬本体未被动过
  const saved = await INV.getInvitation(db, inv._id);
  assert.eq(saved.title, FIELDS.title, '标题未被他人改动');
});

test('请柬回执：提交落库；同 guestKey 重复提交更新同一条', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  const r1 = await INV.submitRsvp(db, inv._id, { guestName: '王五', attend: 'attend', count: 2, guestKey: 'guestA' });
  assert.eq(r1.updated, false, '首次提交为新建');
  const r2 = await INV.submitRsvp(db, inv._id, { guestName: '王五', attend: 'attend', count: 4, note: '带爸妈', guestKey: 'guestA' });
  assert.eq(r2.updated, true, '重复提交为更新');
  assert.eq(r2._id, r1._id, '同一条回执');
  assert.eq(r2.count, 4, '人数已更新');
  const all = await db.collection(COLLECTIONS.Rsvp).find({ invitationId: inv._id });
  assert.eq(all.length, 1, '回执总数仍为 1（去重）');
  // 无 guestKey 的提交各自独立成条
  await INV.submitRsvp(db, inv._id, { guestName: '路人甲', attend: 'undecided' });
  await INV.submitRsvp(db, inv._id, { guestName: '路人甲', attend: 'undecided' });
  assert.eq(await db.collection(COLLECTIONS.Rsvp).count({ invitationId: inv._id }), 3, '无 key 不去重');
  // getMyRsvp 回填
  const mine = await INV.getMyRsvp(db, inv._id, 'guestA');
  assert.eq(mine.count, 4, '按 guestKey 查回自己的回执');
});

test('请柬回执：校验（姓名必填、出席合法、非参加人数归 0、请柬须存在）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  await expectErr(INV.submitRsvp(db, inv._id, { guestName: ' ', attend: 'attend' }), '姓名');
  await expectErr(INV.submitRsvp(db, inv._id, { guestName: '王五', attend: 'maybe' }), '是否参加');
  await expectErr(INV.submitRsvp(db, '不存在的id', { guestName: '王五', attend: 'attend' }), '请柬不存在');
  const r = await INV.submitRsvp(db, inv._id, { guestName: '赵六', attend: 'absent', count: 5 });
  assert.eq(r.count, 0, '不参加时人数归 0，不污染参加人数合计');
});

test('请柬回执统计：参加人数合计/组数/不参加/未定正确', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  await INV.submitRsvp(db, inv._id, { guestName: '甲', attend: 'attend', count: 2, guestKey: 'k1' });
  await INV.submitRsvp(db, inv._id, { guestName: '乙', attend: 'attend', count: 3, guestKey: 'k2' });
  await INV.submitRsvp(db, inv._id, { guestName: '丙', attend: 'absent', guestKey: 'k3' });
  await INV.submitRsvp(db, inv._id, { guestName: '丁', attend: 'undecided', guestKey: 'k4' });
  const s = await INV.getRsvpStats(db, 'owner1', inv._id);
  assert.eq(s.total, 4, '回执总数');
  assert.eq(s.attendParties, 2, '参加组数');
  assert.eq(s.attendPeople, 5, '参加人数合计 2+3');
  assert.eq(s.absentParties, 1, '不参加组数');
  assert.eq(s.undecidedParties, 1, '未定组数');
  // 列表概况同步
  const list = await INV.listInvitations(db, 'owner1');
  assert.eq(list[0].rsvpCount, 4, '列表回执数');
  assert.eq(list[0].attendPeople, 5, '列表参加人数');
});

test('请柬回执：一键加入亲友录走正规路径并回填 contactId，重复加不重复建', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  const r = await INV.submitRsvp(db, inv._id, { guestName: '新朋友', attend: 'attend', count: 1, guestKey: 'k1' });
  const res = await INV.addRsvpGuestToContacts(db, 'owner1', inv._id, r._id);
  assert(res.contactId, '应返回 contactId');
  assert.eq(res.alreadyAdded, false, '首次为新建');
  const contact = await db.collection(COLLECTIONS.Contact).findOne({ _id: res.contactId });
  assert(contact, '联系人已落库');
  assert.eq(contact.name, '新朋友', '联系人姓名');
  assert.eq(contact.createdBy, 'owner1', 'createdBy=主人（正规创建路径）');
  assert(contact.remark.includes('婚礼'), '备注带请柬来源');
  const savedRsvp = await db.collection(COLLECTIONS.Rsvp).findOne({ _id: r._id });
  assert.eq(savedRsvp.contactId, res.contactId, '回执 contactId 已回填');
  const again = await INV.addRsvpGuestToContacts(db, 'owner1', inv._id, r._id);
  assert.eq(again.alreadyAdded, true, '重复点返回 alreadyAdded');
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: 'owner1' }), 1, '不重复建联系人');
});

test('请柬回执：加亲友重名只提醒不合并（仍新建）', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  await core.contacts.createContact(db, 'owner1', 'owner1', { name: '王五', remark: '老同学' });
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  const r = await INV.submitRsvp(db, inv._id, { guestName: '王五', attend: 'attend', count: 2, guestKey: 'k9' });
  const res = await INV.addRsvpGuestToContacts(db, 'owner1', inv._id, r._id);
  assert.eq(res.duplicateWarning, true, '重名应提醒');
  assert.eq(await db.collection(COLLECTIONS.Contact).count({ ownerId: 'owner1' }), 2, '重名不合并：新建第二位');
});

test('请柬：删除连带删除全部回执', async () => {
  const db = await h.newDB();
  await h.newUser(db, 'owner1');
  const inv = await INV.createInvitation(db, 'owner1', { ...FIELDS });
  await INV.submitRsvp(db, inv._id, { guestName: '甲', attend: 'attend', count: 1, guestKey: 'k1' });
  await INV.submitRsvp(db, inv._id, { guestName: '乙', attend: 'absent', guestKey: 'k2' });
  const res = await INV.deleteInvitation(db, 'owner1', inv._id);
  assert.eq(res.removedRsvps, 2, '连带删除回执数');
  assert.eq(await INV.getInvitation(db, inv._id), null, '请柬已删');
  assert.eq(await db.collection(COLLECTIONS.Rsvp).count({ invitationId: inv._id }), 0, '回执已清');
});

test('请柬风格：4 种风格常量齐全且字段完整', async () => {
  const { STYLES, getStyle } = core.invitationStyles;
  assert.eq(STYLES.length, 4, '四种风格');
  const ids = STYLES.map((s) => s.id).join(',');
  assert.eq(ids, 'guochao,cream,french,wood', '风格 id 顺序');
  for (const s of STYLES) {
    assert(s.colors && s.colors.primary && s.colors.paper, `${s.id} 配色完整`);
    assert(s.borderCss && s.fontStack && s.name, `${s.id} 边框/字体/名称完整`);
  }
  assert.eq(getStyle('nope').id, 'guochao', '未知风格回落第一种');
});
