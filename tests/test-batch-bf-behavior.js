/**
 * BF批断言（2026-10-31 家庭共享闭环：16 项，含 23:30–23:34 对第 9、12 项的纠正）：
 * ① 核心：邀请备注存取（限 16 字）、接受记 acceptedAt、待接受 48 小时惰性失效
 *    （旧卡点开报已失效、成员管理不再列出、库里标 expired 不真删）、已移除不列出、
 *    已接受排前／待接受排后、备注＞真实昵称＞礼友＋数字、范围摘要、授权改后立即生效；
 * ② 成员记账只写账本主人账、越权（未授权事件／未授权送礼／未授权联系人）被服务端驳回；
 * ③ 共享页礼薄块笔数／金额（memberEvents 附 count／totalFen）；
 * ④ 前端静态：入口放行、两块渐变、轻提示、淡蓝隔断、红条进路与叉去向、权限胶囊、
 *    礼薄行与送礼圆圈送、往来块与差额块、合计范围 'all'、备注 16 字与 48 小时提醒、
 *    成员分开展示、新增／修改页接 ownerId。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;

const rd = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const mp = (rel) => rd(`miniprogram/pages/${rel}`);

async function assertPermDenied(promise, label) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert(err, `${label}：应抛错`);
  assert(err.message.includes('无权限'), `${label}：应为无权限拒绝，实际：${err.message}`);
}

test('BF核心：邀请备注存取（16 字截断）＋成员列表回显备注／昵称／范围摘要', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, {
    switches: { view: true, add: true }, scope: { events: [ev], gifts: true },
    remark: '老婆',
  });
  const long = await core.share.invite(db, owner, {
    switches: { view: true }, scope: { events: [ev], gifts: false },
    remark: '一二三四五六七八九十一二三四五六七八九十',
  });
  await core.share.accept(db, member, inv.membershipId);
  const list = await core.share.listMembers(db, owner);
  const acc = list.find((m) => m._id === inv.membershipId);
  assert(acc && acc.remark === '老婆', '已接受成员应回显备注');
  assert(acc.memberName, '已接受成员应有真实昵称（或礼友＋数字）');
  assert(acc.scopeText.includes('张三的婚宴') && acc.scopeText.includes('送礼记录'), '范围摘要应含事件名与送礼记录');
  assert(acc.acceptedAt, '接受后应记 acceptedAt');
  const longDoc = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: long.membershipId });
  assert([...longDoc.remark].length === 16, `备注应按码点限 16 字，实际 ${[...longDoc.remark].length}`);
  const pend = list.find((m) => m._id === long.membershipId);
  assert(pend && pend.status === 'pending', '未接受的应列为待接受');
  assert(list[0].status === 'active', '已接受应排在待接受前面');
});

test('BF核心：待接受超 48 小时惰性失效（接受被拒、标 expired、不列出、不真删）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, {
    switches: { view: true }, scope: { events: [ev], gifts: false },
  });
  // 把创建时间拨到 49 小时前，模拟旧待接受
  await db.collection(COLLECTIONS.ShareMembership).update(
    { _id: inv.membershipId }, { createdAt: Date.now() - 49 * 3600 * 1000 });
  let err = null;
  try { await core.share.accept(db, member, inv.membershipId); } catch (e) { err = e; }
  assert(err && err.message.includes('已失效'), `旧待接受接受时应报已失效，实际：${err && err.message}`);
  const doc = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert(doc && doc.status === 'expired', '旧待接受应标为 expired（不真删库）');
  const ms = await core.share.getMembership(db, member, inv.membershipId);
  assert(ms.status === 'expired', '查邀请应返回 expired，不得当 pending 接受');
  const list = await core.share.listMembers(db, owner);
  assert(!list.some((m) => m._id === inv.membershipId), '超期待接受在成员管理里不再列出');
});

test('BF核心：新待接受可接受；已移除不列出；授权改后立即生效', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'member1');
  const inv = await core.share.invite(db, owner, {
    switches: { view: true }, scope: { events: [ev], gifts: false },
  });
  await core.share.accept(db, member, inv.membershipId);
  let grant = await core.share.getMyGrantFor(db, member, owner);
  assert(grant.switches.view === true, '接受后应有查看授权');
  await core.share.updateGrant(db, owner, inv.membershipId, {
    switches: { view: true, add: true }, scope: { events: [ev], gifts: false },
  });
  grant = await core.share.getMyGrantFor(db, member, owner);
  assert(grant.switches.add === true, 'updateGrant 后 getMyGrantFor 应立即变（不缓存）');
  await core.share.updateGrant(db, owner, inv.membershipId, {
    switches: { view: true, add: true }, scope: { events: [ev], gifts: false }, remark: '儿子',
  });
  const doc = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert(doc.remark === '儿子', '成员详情页补改备注应经 updateGrant 落库');
  await core.share.removeMember(db, owner, inv.membershipId);
  const list = await core.share.listMembers(db, owner);
  assert(!list.some((m) => m._id === inv.membershipId), '已移除的成员不再列出');
  const kept = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert(kept && kept.status === 'removed', '移除只改状态、不删库');
});

test('BF核心：成员记账只写账本主人账；越权事件／送礼／联系人被服务端驳回', async () => {
  const db = await h.newDB();
  const { owner, c1, c2, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, {
    events: [ev], gifts: false, switches: { view: true, add: true },
  });
  const r = await core.receive.createRecord(db, member, owner, ev, {
    contactId: c1, amount: 20000, type: '现金', date: '2026-10-02',
  });
  // createRecord 只返回 {_id}，故按 id 查库核对归属与记账人
  const saved = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: r._id });
  assert(saved.ownerId === owner, '成员新增应记到账本主人名下，绝不写自己账');
  assert(saved.createdBy === member, '成员新增应留记账人（审计用）');
  const ev2 = await core.receive.createEvent(db, owner, owner, { name: '未授权的礼薄', tagId: 'jiehun', date: '2026-10-03' });
  await assertPermDenied(core.receive.createRecord(db, member, owner, ev2._id, {
    contactId: c1, amount: 10000, type: '现金', date: '2026-10-03',
  }), '未授权礼薄新增');
  await assertPermDenied(core.gifts.createGift(db, member, owner, {
    contactId: c2, tagId: 'shengri', amount: 10000, date: '2026-10-03',
  }), '未授权送礼新增');
  await assertPermDenied(core.receive.createRecord(db, member, owner, ev, {
    contactId: c2, amount: 10000, type: '现金', date: '2026-10-03',
  }), '未授权联系人新增（c2 只出现在送礼记录，未授权送礼时不可见）');
});

test('BF核心：成员礼薄块附笔数与金额（memberEvents count／totalFen）', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, { events: [ev], gifts: false });
  const events = await core.stats.memberEvents(db, member, owner);
  assert(events.length === 1, '成员应只看到授权的一本');
  assert.eq(events[0].count, 1, '礼薄块笔数应为 1');
  assert.eq(events[0].totalFen, 100000, '礼薄块金额应为 100000 分');
});

test('BF前端：首页放行＋共享首页两块渐变／轻提示／淡蓝隔断', () => {
  const idxJs = mp('index/index.js');
  assert(idxJs.includes('hasReceivedShare'), '首页应有 hasReceivedShare 状态');
  assert(idxJs.includes('myReceivedShares()'), '首页 refreshMember 里应一并查已收到共享');
  assert(idxJs.includes("id === 'share' && this.data.hasReceivedShare"), '首页家庭共享入口应对已收到共享放行');
  assert(idxJs.includes('photoImport'), '拍照导入门禁应保留（不受放行影响）');
  const home = mp('share/share-home.wxml');
  assert(home.includes('linear-gradient(135deg, #FFC7C3, #F78C8F)'), '邀请家人块应为送礼粉红渐变');
  assert(home.includes('linear-gradient(135deg, #FFE4B8, #FDBE68)'), '成员管理块应为收礼橙黄渐变');
  assert(home.includes('border-radius:12px'), '两块应为 12px 圆角');
  assert(home.includes('font-size:16px'), '主标应为 16px');
  assert(home.includes('font-size:20px'), '三角应为 20px（只改共享页）');
  assert(home.includes('background:#E2EEFB'), '我收到的共享应为淡蓝 #E2EEFB 独立方块');
  assert(home.includes('margin-top:20px'), '我收到的共享标题上边距应加大、露出灰底隔断');
  const homeJs = mp('share/share-home.js');
  const toast = "wx.showToast({ title: '请开通会员邀请家人', icon: 'none', duration: 1500 })";
  assert((homeJs.split(toast).length - 1) >= 2, '非会员点邀请家人／成员管理都应只出轻提示（不跳转、不弹窗）');
});

test('BF前端：共享页红条进路与叉、权限胶囊、礼薄行、往来块、差额块、合计 all', () => {
  const viewJs = mp('share/share-view.js');
  const viewWxml = mp('share/share-view.wxml');
  const viewWxss = mp('share/share-view.wxss');
  assert(viewJs.includes('fromLink'), '共享页应区分链接进来与家庭共享进来');
  assert(viewJs.includes("wx.switchTab({ url: '/pages/index/index' })"), '右上角叉点后应 switchTab 回首页');
  assert(viewJs.includes('onShow'), '共享页应加 onShow 重查授权（权限改后立即生效）');
  assert(viewJs.includes("range: 'all'"), '合计范围应为字符串 all（全部时间）');
  assert(!viewJs.includes("range: { opt: 'lastYear' }"), '合计不得再传 {opt:lastYear}（会被吞错兜底 0）');
  assert(viewJs.includes('getGrantFor'), '权限胶囊授权应取自 getGrantFor（实时查）');
  assert(viewJs.includes('onEventTap') && viewJs.includes('onGiftsTap'), '礼薄行与送礼行应可点进账本主人页');
  assert(viewJs.includes('家人的账本') || viewWxml.includes('家人的账本'), '称呼保持"家人的账本"不变');
  assert(viewWxml.includes('请从家庭共享入口进入'), '底部红条文案应为"请从家庭共享入口进入"');
  assert(viewWxml.includes('你被授权：'), '横幅下应有"你被授权："');
  assert(viewWxml.includes('送'), '送礼行图标应为圆圈"送"字');
  assert(viewWxml.includes('差额'), '往来下应有差额块（与合计同块）');
  assert(!viewWxml.includes('bindtap') || viewWxml.includes('onClosePage'), '红条本身不是按钮（无 bindtap）；叉另有 onClosePage');
  assert(viewWxss.includes('#E0F3E4'), '被授权胶囊应为导出备份绿 #E0F3E4');
  assert(viewWxss.includes('#F0575A'), '底部红条应为拍照送礼红 #F0575A');
  assert(viewWxss.includes('#FFF8E1'), '差额块应为淡黄底');
  assert(viewWxss.includes('linear-gradient(135deg, #FFC7C3, #F78C8F)'), '往来送礼块应为粉红渐变');
  assert(viewWxss.includes('linear-gradient(135deg, #FFE4B8, #FDBE68)'), '往来收礼块应为橙黄渐变');
  const viewCapsule = viewWxml.match(/capsule[^>]*>/g) || [];
  assert(!viewWxml.includes('bindtap="onCapsule'), '权限胶囊只展示、点它不做事（无点击处理）');
  assert(viewCapsule.length >= 1, '应有胶囊元素');
});

test('BF前端：邀请页备注＋48 小时提醒；成员详情可补改备注；成员管理分开展示', () => {
  const invWxml = mp('share/share-invite.wxml');
  const invJs = mp('share/share-invite.js');
  assert(!invWxml.includes('点下方按钮发给微信好友，对方点开就能加入你的账本，不用填任何码。'), '邀请家人按钮上方旧提示应去掉');
  assert(invWxml.includes('你给家人的备注'), '邀请页应有"给家人的备注"输入框');
  assert(invWxml.includes('如：老婆、儿子，不填则显示对方昵称'), '备注占位应为"如：老婆、儿子，不填则显示对方昵称"');
  assert(invWxml.includes('maxlength="16"'), '备注限 16 字');
  assert(invWxml.includes('被邀请人须在48小时内接受，超时邀请自动失效，须重新邀请。'), '备注下应有 48 小时提醒小字');
  assert(invJs.includes('remark: this.data.remark'), '预生成 payload 应带备注');
  assert(invJs.includes('onRemarkInput'), '备注输入应有处理函数');
  const grantWxml = mp('share/share-grant.wxml');
  const grantJs = mp('share/share-grant.js');
  assert(grantWxml.includes('你给家人的备注'), '成员详情页应能补改备注');
  assert(grantWxml.includes("{{isPending ? '作废邀请' : '移除成员'}}"), '待接受行按钮文案应为作废邀请，已接受为移除成员');
  assert(grantJs.includes('payload.remark'), '保存时应经 updateGrant 带备注');
  const membersJs = mp('share/share-members.js');
  const membersWxml = mp('share/share-members.wxml');
  assert(membersJs.includes('m.remark || m.memberName'), '已接受主名应按备注＞真实昵称');
  assert(membersJs.includes('acceptedAt'), '已接受应含接受时间（无时用发出时间兜底并说明）');
  assert(membersJs.includes('scopeText'), '待接受应含范围摘要');
  assert(membersWxml.includes('已接受成员') && membersWxml.includes('待接受邀请'), '成员管理应分已接受／待接受两块展示');
});

test('BF前端：详情／新增／修改／选亲友页接账本主人（绝不写自己账）', () => {
  const ds = rd('miniprogram/services/data-service.js');
  assert(ds.includes('shareInvite({ switches, scope, remark })'), 'data-service shareInvite 应接备注');
  assert(ds.includes('updateGrant(membershipId, { switches, scope, remark })'), 'data-service updateGrant 应接备注');
  assert(ds.includes('const cacheKey = `${owner}:${eventId}`'), '礼薄详情缓存键应含账本主人（防串本）');
  assert(ds.includes('async listGifts(ownerId)'), '送礼列表应接账本主人参数');
  assert(mp('receive-detail/receive-detail.js').includes('options.ownerId'), '礼薄详情应接 ownerId');
  assert(mp('receive-detail/receive-detail.js').includes('getEventDetail(this.eventId, owner'), '礼薄详情应按账本主人取数');
  assert(mp('gifts/gifts.js').includes('listGifts(owner'), '送礼页应按账本主人取数');
  assert(mp('gifts/gifts.js').includes('listContactsFor(owner)'), '送礼页亲友应走账本主人可见列表');
  assert(mp('receive-record-detail/receive-record-detail.js').includes('getRecordDetail(this.recordId, owner'), '收礼详情应按账本主人取数');
  assert(mp('gift-detail/gift-detail.js').includes('getGiftDetail(this.giftId, owner'), '送礼详情应按账本主人取数');
  assert(mp('receive-record-add/receive-record-add.js').includes('this.ownerId || undefined'), '收礼新增保存应带账本主人');
  assert(mp('gift-add/gift-add.js').includes('this.ownerId || undefined'), '送礼新增保存应带账本主人');
  assert(mp('receive-record-edit/receive-record-edit.js').includes('this.ownerId || undefined'), '收礼修改保存应带账本主人');
  assert(mp('gift-edit/gift-edit.js').includes('this.ownerId || undefined'), '送礼修改保存应带账本主人');
  assert(mp('choose-contact/choose-contact.js').includes('canAddContact'), '选亲友页成员视角应隐藏新增亲友按钮');
  assert(mp('choose-contact/choose-contact.js').includes('listContactsFor'), '选亲友页成员视角应只列账本主人可见亲友');
});

test('BF前端：00e5b1f 四项仍在（陪伴 16／17、邀请分享页两处黄字已删）', () => {
  const mineWxss = mp('mine/mine.wxss');
  assert(mineWxss.includes('.companion-text') && mineWxss.includes('16px'), '陪伴文字应为 16px');
  assert(mineWxss.includes('.companion-icon') && mineWxss.includes('17px'), '陪伴图标应为 17px');
  const reward = mp('invite/invite-reward.wxml');
  assert(!reward.includes('还可再邀请几位新朋友'), '邀请分享页上边第一处黄字应已删');
  assert(!reward.includes('点按钮就能直接发给微信好友，对方点开卡片即可，不用填任何码'), '邀请分享页上边第二处黄字应已删');
  assert(reward.includes('奖励额度发放后立即计入你的可用额度'), '最下面奖励额度说明应留着');
});
