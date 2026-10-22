/** 真机反馈第一批（任务X，2026-10-22 用户在开发者工具/真机实测后下达）：
 * 行为测试：stats 'all' 全量统计、家庭共享邀请码流程（不绑定亲友、谁接受谁绑定）；
 * 源码断言：fab 两种高度、编辑页按钮「修改」、小喇叭无滚动跑马灯、礼薄详情按钮移位、
 * 往来 RANGES 含全部且 diffText 不拼「差额」、亲友表单 80vh 左右排、横置（三改已于第二批回退，见 test-batch-y）、
 * 邀请页去 picker 走微信分享、联系人姓名去宋体统一默认字体、Tab 图标互换。 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

const REPO = path.join(__dirname, '..');
const MP = path.join(REPO, 'miniprogram');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = fmt(new Date());
const D400 = fmt(new Date(Date.now() - 400 * 86400e3));

// ---------- 第 5 项：往来「全部」 ----------
test('任务X-往来全部：contactStats range=all 含 400 天前与今天的全部记录', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'ownerX', { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
  const c = await core.contacts.createContact(db, owner, owner, { name: '张三' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '旧礼薄', tagId: 'qita', date: D400 });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: c._id, amount: 20000, type: '红包', date: D400 });
  await core.gifts.createGift(db, owner, owner, { contactId: c._id, tagId: 'qita', amount: 30000, date: TODAY });
  const st = await core.stats.contactStats(db, owner, c._id, { range: 'all' });
  assert.eq(st.receiveTotalFen, 20000, 'all 应含 400 天前收礼');
  assert.eq(st.giftTotalFen, 30000, 'all 应含今天送礼');
  assert.eq(st.receiveCount + st.giftCount, 2, 'all 笔数=全部');
  const tl = await core.stats.timeline(db, owner, c._id, { range: 'all' });
  assert.eq(tl.items.length, 2, '竖线树 range=all 不报错且含全部');
  const ws = await core.stats.getWanglaiStats(db, owner, owner, { preset: 'all' });
  assert.eq(ws.receiveTotal, 20000, '全局统计 all 收礼');
  assert.eq(ws.giftTotal, 30000, '全局统计 all 送礼');
});

test('任务X-往来全部：页面 RANGES 首项为全部、diffText 不再拼「差额」、rangeText 有全部时间', () => {
  const js = readMp('pages/wanglai/wanglai.js');
  const allIdx = js.indexOf("{ id: 'all', name: '全部' }");
  assert(allIdx > -1, 'RANGES 应含 {id:all,name:全部}');
  assert(allIdx < js.indexOf("{ id: 'today'"), '全部应排在今日之前（首项）');
  assert(!js.includes('`差额 ${'), 'diffText 不应再拼「差额 」前缀（wxml 已有 diff-label）');
  assert(js.includes("rangeId === 'all' ? '全部时间'"), 'rangeId=all 时 rangeText 应显示「全部时间」');
  const wxml = readMp('pages/wanglai/wanglai.wxml');
  assert(wxml.includes('<text class="diff-label">差额</text>'), 'wxml 的 diff-label 保留（唯一的「差额」字样来源）');
});

// ---------- 第 8 项：家庭共享邀请走微信 ----------
test('任务X-共享邀请：invite 不绑定亲友（pending、memberId 空），他人凭码 accept 即绑定', async () => {
  const db = await h.newDB();
  const { owner, ev } = await h.setupOwner(db);
  const member = await h.newUser(db, 'memberX');
  const inv = await core.share.invite(db, owner, { switches: { view: true }, scope: { events: [ev], gifts: false } });
  assert(inv.membershipId, 'invite 应返回 membershipId 作为邀请码');
  const ms = await db.collection(core.models.COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert.eq(ms.status, 'pending', '新建邀请应为 pending');
  assert.eq(ms.memberId, '', '新建邀请不应绑定任何亲友（谁接受谁绑定）');
  await core.share.accept(db, inv.membershipId, member);
  const ms2 = await db.collection(core.models.COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert.eq(ms2.status, 'active', '接受后应 active');
  assert.eq(ms2.memberId, member, '接受者即绑定者');
});

test('任务X-共享邀请：页面已去 picker、生成邀请后出现微信分享按钮、落地页凭码接受', () => {
  const wxml = readMp('pages/share/share-invite.wxml');
  const js = readMp('pages/share/share-invite.js');
  assert(!wxml.includes('<picker'), '邀请页不应再有亲友录 picker');
  assert(!js.includes('onContactChange'), '邀请页 js 不应再有选亲友逻辑');
  assert(wxml.includes('生成邀请'), '应有「生成邀请」按钮');
  assert(wxml.includes('open-type="share"'), '生成后应出现 open-type=share 的微信分享按钮');
  assert(wxml.includes('邀请家人（发给微信好友）'), '分享按钮文案');
  assert(wxml.includes('{{inviteCode}}'), '应展示邀请码文字兜底');
  assert(js.includes('onShareAppMessage'), '页面应实现 onShareAppMessage');
  assert(js.includes('/pages/share/share-view?code='), '分享 path 应带 code 落到 share-view');
  const view = readMp('pages/share/share-view.js');
  assert(view.includes('query.code') && view.includes('acceptShare'), 'share-view 应凭 query.code 调 acceptShare 接受邀请');
  const ds = readMp('services/data-service.js');
  assert(ds.includes('getShareMembership'), 'data-service 应提供 getShareMembership 供落地页查邀请');
});

// ---------- 第 1 项：红色＋两种高度 ----------
test('任务X-加号统一：app.wxss 只保留 70px(Tab页) 与 24px(非Tab页) 两种高度且 fab-low 后置覆盖', () => {
  const wxss = readMp('app.wxss');
  assert(wxss.includes('bottom: calc(70px + env(safe-area-inset-bottom))'), '.fab 应为 Tab 页高度 70px');
  assert(wxss.includes('.fab-low { bottom: 24px; bottom: calc(24px + env(safe-area-inset-bottom)); }'), '.fab-low 应为 24px');
  assert(wxss.indexOf('\n.fab-low {') > wxss.indexOf('\n.fab {'), '.fab-low 规则必须定义在 .fab 之后才能覆盖');
  const contacts = readMp('pages/contacts/contacts.wxml');
  assert(contacts.includes('class="fab"'), '亲友录用 .fab（70px，Tab 栏上方约 20px）');
});

// ---------- 第 2 项：编辑页按钮「修改」 ----------
test('任务X-编辑按钮：修改页底部按钮为「修改」，添加页保持「保存」', () => {
  assert(readMp('pages/gift-edit/gift-edit.wxml').includes('>修改</view>'), 'gift-edit 按钮应为修改');
  assert(readMp('pages/receive-record-edit/receive-record-edit.wxml').includes('>修改</view>'), 'receive-record-edit 按钮应为修改');
  assert(readMp('pages/receive-add/receive-add.wxml').includes("{{isEdit ? '修改' : '保存'}}"), 'receive-add 应按修改/添加模式切换按钮文案');
  assert(readMp('pages/gift-add/gift-add.wxml').includes('>保存</view>'), 'gift-add 保持保存');
  assert(readMp('pages/receive-record-add/receive-record-add.wxml').includes('>保存</view>'), 'receive-record-add 保持保存');
});

// ---------- 第 3 项：小喇叭静态（第二批修订：允许慢速闪烁动画，仍禁滚动跑马灯） ----------
test('任务X-小喇叭：收礼页无滚动跑马灯，仅慢速闪烁动画（任务Y 新规格）', () => {
  const wxss = readMp('pages/receive/receive.wxss');
  assert(!wxss.includes('hornscroll'), 'hornscroll 跑马灯关键帧应删除');
  assert(!wxss.includes('translateX'), '不应有位移滚动动画');
  assert(wxss.includes('hornBlink'), '应有慢速柔和闪烁动画 hornBlink（任务Y）');
});

// ---------- 第 4 项：礼薄详情按钮移位 ----------
test('任务X-礼薄详情：底部按钮条删除，修改/删除移至顶部信息卡右上角', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  assert(!wxml.includes('bottom-btns'), '底部按钮条应删除');
  assert(!wxml.includes('height:130px'), '130px 占位应删除');
  assert(wxml.includes('card-actions'), '应有卡内右上角操作区');
  assert(wxml.includes('bindtap="goEdit">修改</text>'), '修改入口走原 goEdit');
  assert(wxml.includes('bindtap="onDelete">删除</text>'), '删除入口走原 onDelete（仍弹统一确认框）');
  assert(readMp('pages/receive-detail/receive-detail.wxss').includes('.card-actions'), 'wxss 应有 .card-actions 定位');
});

// ---------- 第 6 项：亲友表单重做 ----------
test('任务X-亲友表单：两组件 80vh、顶部取消、左右排字段、底部整宽红按钮（添加/修改）', () => {
  const addW = readMp('components/contact-sheet/contact-sheet.wxml');
  const addS = readMp('components/contact-sheet/contact-sheet.wxss');
  const editW = readMp('components/contact-edit-sheet/contact-edit-sheet.wxml');
  const editS = readMp('components/contact-edit-sheet/contact-edit-sheet.wxss');
  for (const [w, s] of [[addW, addS], [editW, editS]]) {
    assert(s.includes('height: 80vh'), '面板高应约 80vh');
    assert(w.includes('cs-cancel') && w.includes('>取消</text>'), '顶部左上角应有「取消」文字');
    assert(w.includes('cs-row') && w.includes('cs-label') && w.includes('cs-input'), '字段应为左右排（标签+同行输入）');
    assert(w.includes('cs-primary'), '底部应为整宽红色主按钮');
  }
  assert(addW.includes('bindtap="onConfirm">添加</view>'), '添加版按钮文案「添加」');
  assert(editW.includes('bindtap="onConfirm">修改</view>'), '编辑版按钮文案「修改」');
  assert(!editW.includes('确认修改'), '编辑版不应再叫「确认修改」');
});

// ---------- 第 7 项：横置强制横屏 + 返回竖屏（已被任务Y 全部回退，断言移交 test-batch-y） ----------
test('任务X-横置：三改回退口径以任务Y 为准（此处仅保留 rotate 页方向断言）', () => {
  assert(JSON.parse(readMp('pages/landscape/rotate/rotate.json')).pageOrientation === 'auto', 'rotate 页保持 auto');
});

// ---------- 第 9 项：联系人姓名字体统一 ----------
test('任务X-姓名字体：联系人姓名不再用宋体（与首页最近往来同为默认黑体），礼薄名标题保留宋体', () => {
  const files = [
    'pages/wanglai/wanglai.wxml', 'pages/contacts/contacts.wxml', 'pages/gifts/gifts.wxml',
    'pages/choose-contact/choose-contact.wxml', 'pages/receive-detail/receive-detail.wxml',
    'pages/example/receive-example.wxml', 'pages/example/gift-example.wxml',
  ];
  for (const f of files) {
    assert(!readMp(f).includes('class="nm songti"'), `${f} 的联系人姓名不应再带 songti`);
    assert(!readMp(f).includes('class="rec-name songti"'), `${f} 的联系人姓名不应再带 songti`);
  }
  const wanglaiWxss = readMp('pages/wanglai/wanglai.wxss');
  const nmBlock = (wanglaiWxss.match(/\.wl-row \.nm \{[^}]*\}/) || [''])[0];
  assert(!nmBlock.includes('font-family'), 'wanglai 列表姓名不应再单独声明宋体 font-family');
  assert(readMp('pages/receive/receive.wxml').includes('class="nm songti"'), '收礼列表的礼薄名（标题类）保留宋体');
});

// ---------- 第 10 项：Tab 图标互换 ----------
test('任务X-Tab图标：首页与往来的图标已互换（文字/路径不动）', () => {
  const app = JSON.parse(readMp('app.json'));
  const [home, wanglai] = app.tabBar.list;
  assert.eq(home.text, '首页', '第一项文字仍是首页');
  assert.eq(home.pagePath, 'pages/index/index', '第一项路径不变');
  assert.eq(home.iconPath, 'images/tabbar/wanglai.png', '首页改用原往来图标');
  assert.eq(home.selectedIconPath, 'images/tabbar/wanglai-active.png', '首页选中图标互换');
  assert.eq(wanglai.text, '往来', '第二项文字仍是往来');
  assert.eq(wanglai.iconPath, 'images/tabbar/home.png', '往来改用原首页图标');
  assert.eq(wanglai.selectedIconPath, 'images/tabbar/home-active.png', '往来选中图标互换');
});
