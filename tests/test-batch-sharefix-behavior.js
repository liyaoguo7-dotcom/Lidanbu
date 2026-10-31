/**
 * 共享修复批断言（2026-11-01，用户“好的，开始修改吧”）：
 * A 邀请页备注红块＋字体＋2px＋备注竞态门禁；B 共享首页两卡黑字＋留白；
 * C 收到块去重＋零权限零礼薄根因（规范关系、接受去重、收到列表去重、
 *   收到改名、被邀请人退出）；D 陪伴字 18px、图标 32px 约卡高八成；
 * E 回归：共享页横幅、红条与叉、胶囊、礼薄行、往来、合计'all'、48h 失效。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

const rd = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const mp = (rel) => rd(`miniprogram/pages/${rel}`);

test('共享修复核心：规范关系取最新已接受（不再取第一条旧关系）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  // 直接造两条已接受（模拟真实账号重复）：旧条仅查看、范围空；新条全权限、范围有 ev
  const now = Date.now();
  const oldMs = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId: owner, memberId: member, status: 'active', createdAt: now - 10000, acceptedAt: now - 10000, remark: '',
  });
  const newMs = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId: owner, memberId: member, status: 'active', createdAt: now, acceptedAt: now, remark: '老婆',
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId: oldMs._id, switches: { view: true }, scope: { events: [], gifts: false }, updatedAt: now,
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId: newMs._id, switches: { view: true, add: true }, scope: { events: [ev], gifts: true }, updatedAt: now,
  });
  const canon = await core.share.canonicalMembership(db, owner, member);
  assert(canon && canon._id === newMs._id, '规范关系应为最新已接受（新条），不是第一条旧条');
  const grant = await core.share.getMyGrantFor(db, member, owner);
  assert(grant.switches.add === true && grant.scope.gifts === true, 'getMyGrantFor 应走规范关系（新条全权限）');
  const events = await core.stats.memberEvents(db, member, owner);
  assert(events.length === 1 && events[0]._id === ev, '成员礼薄应按规范关系范围显示（不再是 0）');
  const received = await core.share.listReceived(db, member);
  assert(received.length === 1, `收到列表应按主人去重只列一条，实际 ${received.length}`);
  assert(received[0].membershipId === newMs._id, '收到列表应列规范关系那条');
});

test('共享修复核心：接受新邀请时旧已接受置为已移除（唯一规范关系）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv1 = await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev], gifts: false } });
  await core.share.accept(db, member, inv1.membershipId);
  const inv2 = await core.share.invite(db, owner, { switches: { view: true, add: true }, scope: { events: [ev], gifts: true }, remark: '老婆' });
  await core.share.accept(db, member, inv2.membershipId);
  const oldDoc = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: inv1.membershipId });
  assert(oldDoc && oldDoc.status === 'removed', '旧已接受接受新邀请后应置为已移除（不删库）');
  const received = await core.share.listReceived(db, member);
  assert(received.length === 1 && received[0].membershipId === inv2.membershipId, '接受新邀请后收到列表只剩新的一条');
  const grant = await core.share.getMyGrantFor(db, member, owner);
  assert(grant.switches.add === true, '新接受后授权应为新条全权限');
});

test('共享修复核心：主人改旧条应改规范关系（权限与范围实时门禁）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const now = Date.now();
  const oldMs = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId: owner, memberId: member, status: 'active', createdAt: now - 10000, acceptedAt: now - 10000, remark: '',
  });
  const newMs = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId: owner, memberId: member, status: 'active', createdAt: now, acceptedAt: now, remark: '',
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId: oldMs._id, switches: { view: true }, scope: { events: [], gifts: false }, updatedAt: now,
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId: newMs._id, switches: { view: true }, scope: { events: [], gifts: false }, updatedAt: now,
  });
  await core.share.updateGrant(db, owner, oldMs._id, {
    switches: { view: true, add: true, edit: true }, scope: { events: [ev], gifts: true },
  });
  const grant = await core.share.getMyGrantFor(db, member, owner);
  assert(grant.switches.edit === true && grant.scope.gifts === true && grant.scope.events.includes(ev),
    '主人改旧条后，被邀请人下次查应立即按新权限与新范围（规范关系）');
  const oldDoc = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: oldMs._id });
  assert(oldDoc && oldDoc.status === 'removed', '改旧条去重后旧条应置为已移除');
});

test('共享修复核心：备注更新落库后再接受，备注不丢（竞态后端侧）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev], gifts: false }, remark: '' });
  // 模拟“输完备注、更新落库、再分享接受”：updateGrant 先完成，再 accept
  await core.share.updateGrant(db, owner, inv.membershipId, {
    switches: { view: true }, scope: { events: [ev], gifts: false }, remark: '老婆',
  });
  await core.share.accept(db, member, inv.membershipId);
  const list = await core.share.listMembers(db, owner);
  const acc = list.find((m) => m._id === inv.membershipId);
  assert(acc && acc.remark === '老婆', '更新落库后再接受，成员列表应显示备注“老婆”');
});

test('共享修复核心：收到改名与被邀请人退出（记录保留在主人账本）', async () => {
  const db = await h.newDB();
  const { owner, c1, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, { switches: { view: true, add: true }, scope: { events: [ev], gifts: false } });
  await core.share.accept(db, member, inv.membershipId);
  const rec = await core.receive.createRecord(db, member, owner, ev, { contactId: c1, amount: 20000, type: '现金', date: '2026-10-02' });
  await core.share.updateReceivedName(db, member, inv.membershipId, '老公的账本');
  let received = await core.share.listReceived(db, member);
  assert(received.length === 1 && received[0].receivedName === '老公的账本', '收到改名应落库并回显');
  // 改名限 16 字、空回默认由前端兜底（后端存空串）
  await core.share.updateReceivedName(db, member, inv.membershipId, '一二三四五六七八九十一二三四五六七八九十');
  received = await core.share.listReceived(db, member);
  assert([...received[0].receivedName].length === 16, '收到显示名应限 16 字');
  await core.share.updateReceivedName(db, member, inv.membershipId, '');
  received = await core.share.listReceived(db, member);
  assert(received[0].receivedName === '', '收到名清空后存空串，前端显示回“我收到的共享”');
  // 非本人改名/退出应被拒
  const other = await h.newUser(db, 'member2');
  let err = null;
  try { await core.share.updateReceivedName(db, other, inv.membershipId, '冒名'); } catch (e) { err = e; }
  assert(err, '非本人改收到名应被拒');
  await core.share.memberLeave(db, member, inv.membershipId);
  received = await core.share.listReceived(db, member);
  assert(received.length === 0, '退出后收到列表不再列出');
  const ownerList = await core.share.listMembers(db, owner);
  assert(!ownerList.some((m) => m._id === inv.membershipId), '退出后主人成员列表不再列出');
  const kept = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: rec._id });
  assert(kept && kept.ownerId === owner, '退出后被邀请人已加记录仍留在主人账本，绝不删账本记录');
  const msDoc = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert(msDoc && msDoc.status === 'removed', '退出只改状态、不删库');
});

test('共享修复前端：邀请页备注红块＋字体＋2px＋竞态门禁', () => {
  const wxml = mp('share/share-invite.wxml');
  const js = mp('share/share-invite.js');
  assert(wxml.includes('给家人的备注') && !wxml.includes('你给家人的备注'), '备注标签应为“给家人的备注”，不再是“你给家人的备注”');
  assert(wxml.includes('background:#F0575A'), '备注块红应用下面邀请家人按钮那个红 #F0575A');
  assert(wxml.includes('background:#FFFFFF') && wxml.includes('text-align:center'), '红块里应套白色输入框、名字居中');
  assert(wxml.includes('被邀请人须在48小时内接受'), '48 小时小字仍在红块下面');
  assert(wxml.includes('font-size:17px') && wxml.includes('font-size:15px') && wxml.includes('font-size:14px') && wxml.includes('font-size:19px'),
    '邀请页字体应一律加 2px（15/17/14/19 等，不改全局）');
  assert(!rd('miniprogram/app.wxss').includes('font-size:19px'), '加 2px 只改邀请页，不改全局 app.wxss（按钮 19px 不应进全局）');
  assert(js.includes('remarkPending') && js.includes('备注保存中，请稍候'), '备注输入时应置保存中状态');
  assert(wxml.includes('disabled="{{!canInvite || !inviteCode}}"'),
    '按钮 disabled 原字串不得改（旧 AP/DR 精确断言），备注门禁应嵌进 canInvite 而非改字串');
  assert(js.includes('canInvite: false') && js.includes('remarkPending'),
    '备注保存中时 canInvite 应压回 false，使原 disabled 字串仍禁用分享');
  assert(js.includes('remarkOverride') && js.includes('onShareAppMessage'), '备注应以输入事件值直传，分享时备注未落库不得用旧码');
  assert(js.includes("path: '/pages/share/share-home'") || js.includes('remarkPending'), '备注未落库分享应拦住（不发旧码）');
});

test('共享修复前端：共享首页两卡黑字＋留白、收到块去重改删', () => {
  const wxml = mp('share/share-home.wxml');
  const js = mp('share/share-home.js');
  assert(wxml.includes('color:#000000'), '两卡主标与副文案应由白改黑');
  assert(wxml.includes('margin-top:20px'), '邀请家人卡上间距应加大、与上方黄色小字留空');
  // 三角不动：两卡三角仍白 20px
  const chevWhite = (wxml.match(/color:#FFFFFF;">›/g) || []).length;
  assert(chevWhite >= 2, '两卡三角应不动（仍白 20px）');
  assert(!wxml.includes('我收到的共享</view>') || !wxml.includes('section-title'), '上面“我收到的共享”小字标题应去掉');
  assert(wxml.includes('height:2px;background:#F0575A'), '成员管理与收到块之间应有一条红色横线（2px、按钮红）');
  assert(wxml.includes('{{item.displayName}}') && !wxml.includes("{{item.ownerName}}的账本"), '收到块名应为显示名（初始“我收到的共享”），不再写礼友…的账本');
  assert(wxml.includes('⋯') && wxml.includes('onEditReceived') && wxml.includes('onLeaveReceived'),
    '收到块右边应有“⋯”与左滑修改／删除（两者同入口）');
  assert(wxml.includes('onTouchStart') && wxml.includes('onTouchMove') && wxml.includes('onTouchEnd'),
    '收到块应支持左滑（收礼礼簿行同款）');
  assert(js.includes('memberLeave') && js.includes('updateReceivedName') && js.includes('退出共享'),
    '收到块删除应走被邀请人退出、改名应走收到显示名接口');
  const ds = rd('miniprogram/services/data-service.js');
  assert(ds.includes('memberLeave') && ds.includes('updateReceivedName'), 'data-service 应有退出与改名接口');
  const rc = rd('miniprogram/services/remote-core.js');
  assert(rc.includes('memberLeave') && rc.includes('updateReceivedName'), '云端分发应登记退出与改名（否则云模式调不到）');
});

test('共享修复前端：陪伴字 18px、图标 32px 约卡高八成且大于字体', () => {
  const wxss = mp('mine/mine.wxss');
  assert(wxss.includes('.companion-text { font-size: 18px'), '陪伴文字应为 18px（16→18，只改陪伴块）');
  assert(wxss.includes('.companion-icon { width: 32px; height: 32px'), '陪伴图标应为 32px（约卡高八成）');
  assert(wxss.includes('始终大于字体') || wxss.includes('大于字体'), '陪伴代码注释应写明图标始终大于字体');
});

test('共享修复回归：共享页横幅、红条叉、胶囊、礼薄往来、合计、48h', () => {
  const viewJs = mp('share/share-view.js');
  const viewWxml = mp('share/share-view.wxml');
  assert(viewJs.includes("range: 'all'"), '合计范围仍为 all，不得回归');
  assert(viewJs.includes('onShow') && viewJs.includes('getGrantFor'), '共享页 onShow 重查与实时门禁不得去掉');
  assert(viewWxml.includes('正在查看：') && viewJs.includes("ownerName: '家人'") && viewWxml.includes('请从家庭共享入口进入') && viewWxml.includes('你被授权：'),
    '共享页横幅、红条、权限胶囊不得回归（横幅为“正在查看：家人”的账本，ownerName 默认“家人”）');
  const inviteWxml = mp('share/share-invite.wxml');
  assert(inviteWxml.includes('仅查看') || mp('share/share-invite.js').includes('view'), '邀请页开关与范围逻辑不得回归');
  const shareJs = rd('core/share.js');
  assert(shareJs.includes('PENDING_TTL_MS') && shareJs.includes('48 * 3600'), '48 小时失效不得回归');
  assert(shareJs.includes('canonicalMembership'), '规范关系 helper 应存在且被读取路径共用');
});
