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
  await core.share.accept(db, member, inv.membershipId);
  const ms2 = await db.collection(core.models.COLLECTIONS.ShareMembership).findOne({ _id: inv.membershipId });
  assert.eq(ms2.status, 'active', '接受后应 active');
  assert.eq(ms2.memberId, member, '接受者即绑定者');
});

test('任务X-共享邀请：页面已去 picker、主按钮即微信分享（任务AB 取消生成一步）、落地页凭码接受', () => {
  const wxml = readMp('pages/share/share-invite.wxml');
  const js = readMp('pages/share/share-invite.js');
  assert(!wxml.includes('<picker'), '邀请页不应再有亲友录 picker');
  assert(!js.includes('onContactChange'), '邀请页 js 不应再有选亲友逻辑');
  assert(!wxml.includes('生成邀请') && !js.includes('onCreate'), '不得再有「生成邀请」按钮/步骤（任务AB 第 7 项）');
  assert(wxml.includes('open-type="share"'), '主按钮应为 open-type=share 的微信分享按钮');
  assert(wxml.includes('>邀请家人</button>'), '分享按钮文案为「邀请家人」');
  // AP批延迟修复后：按钮置灰改由本地同步计算的 canInvite 决定（勾选同一次
  // setData 落地），inviteCode 只给分享 path 带码——断言随新机制更新
  assert(wxml.includes('disabled="{{!canInvite}}"'), '未选范围时按钮置灰（AP批 canInvite 口径）');
  assert(js.includes('_prepareInvite') && js.includes('updateGrant'), 'js 应静默预生成并在勾选变化后更新同一份邀请');
  assert(js.includes('onShareAppMessage'), '页面应实现 onShareAppMessage');
  assert(js.includes('/pages/share/share-view?code='), '分享 path 应带 code 落到 share-view');
  const view = readMp('pages/share/share-view.js');
  assert(view.includes('query.code') && view.includes('acceptShare'), 'share-view 应凭 query.code 调 acceptShare 接受邀请');
  const ds = readMp('services/data-service.js');
  assert(ds.includes('getShareMembership'), 'data-service 应提供 getShareMembership 供落地页查邀请');
});

// ---------- 第 1 项：红色＋两种高度（任务Z 修订 64px） ----------
test('任务X-加号统一：app.wxss 带栏页 64px 与非Tab页 24px 两种高度（任务Z 第 2 项修订）且 fab-low 后置覆盖', () => {
  const wxss = readMp('app.wxss');
  assert(wxss.includes('bottom: calc(64px + env(safe-area-inset-bottom))'), '.fab 应为带栏页高度 64px（任务Z）');
  assert(wxss.includes('.fab-low { bottom: 24px; bottom: calc(24px + env(safe-area-inset-bottom)); }'), '.fab-low 应为 24px');
  assert(wxss.indexOf('\n.fab-low {') > wxss.indexOf('\n.fab {'), '.fab-low 规则必须定义在 .fab 之后才能覆盖');
  const contacts = readMp('pages/contacts/contacts.wxml');
  assert(contacts.includes('class="fab"'), '亲友录用 .fab（64px，栏上方约 14px）');
});

// ---------- 第 2 项：编辑页按钮「修改」 ----------
test('任务X-编辑按钮：修改页底部按钮为「修改」，添加页保持「保存」', () => {
  assert(readMp('pages/gift-edit/gift-edit.wxml').includes('>修改</view>'), 'gift-edit 按钮应为修改');
  assert(readMp('pages/receive-record-edit/receive-record-edit.wxml').includes('>修改</view>'), 'receive-record-edit 按钮应为修改');
  assert(readMp('pages/receive-add/receive-add.wxml').includes("{{isEdit ? '修改' : '保存'}}"), 'receive-add 应按修改/添加模式切换按钮文案');
  assert(readMp('pages/gift-add/gift-add.wxml').includes('>保存</view>'), 'gift-add 保持保存');
  assert(readMp('pages/receive-record-add/receive-record-add.wxml').includes('>保存</view>'), 'receive-record-add 保持保存');
});

// ---------- 第 3 项：小喇叭无滚动跑马灯（闪烁规格以任务AA 最终口径为准，见 test-batch-aa） ----------
test('任务X-小喇叭：收礼页喇叭结构（硬闪已于任务AB 第 8 项改版为慢速左滚）', () => {
  assert(!readMp('app.wxss').includes('hornBlink'), 'app.wxss 不得再有硬闪（任务AB 取消闪烁）');
  assert(readMp('app.wxss').includes('@keyframes hornScroll'), '慢滚动画 hornScroll 定义在 app.wxss 全局（任务AB）');
  assert(readMp('pages/receive/receive.wxml').includes('class="horn"'), '收礼页喇叭为 .horn 结构');
  assert(!readMp('pages/receive/receive.wxml').includes('horn-blink'), '收礼页喇叭不带闪烁类（任务AB）');
});

// ---------- 第 4 项（2026-10-22 晚用户改定）：礼薄详情页取消修改/删除入口 ----------
test('礼薄详情：页内无修改/删除入口（改/删走收礼列表左滑），底部按钮条亦无', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  const js = readMp('pages/receive-detail/receive-detail.js');
  assert(!wxml.includes('card-actions'), '卡内右上角操作区应取消');
  assert(!wxml.includes('>修改</text>') && !wxml.includes('>删除</text>'), '详情页不应再有修改/删除小字入口');
  assert(!js.includes('goEdit') && !js.includes('onConfirmDel'), 'goEdit/删除礼薄方法应移除');
  assert(!wxml.includes('bottom-btns'), '底部按钮条保持删除状态');
  const list = readMp('pages/receive/receive.js');
  assert(list.includes('goRename') && list.includes('askDelete'), '收礼列表左滑应保留修改/删除礼薄入口');
});

// ---------- 第 6 项：亲友表单重做 ----------
test('任务X-亲友表单：顶部取消、左右排字段、底部整宽红按钮（添加 80vh / 修改 60vh，任务Z 第 9 项）', () => {
  const addW = readMp('components/contact-sheet/contact-sheet.wxml');
  const addS = readMp('components/contact-sheet/contact-sheet.wxss');
  const editW = readMp('components/contact-edit-sheet/contact-edit-sheet.wxml');
  const editS = readMp('components/contact-edit-sheet/contact-edit-sheet.wxss');
  assert(addS.includes('height: 80vh'), '添加版面板高约 80vh');
  assert(editS.includes('height: 60vh'), '修改版面板高约 60vh（任务Z 第 9 项：用户反馈太高）');
  for (const [w] of [[addW], [editW]]) {
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
  assert(!readMp('pages/receive/receive.wxml').includes('class="nm songti"'), '收礼列表礼薄名去掉宋体（任务Z 第 10 项，与联系人姓名统一黑体）');
});

// ---------- Tab 图标：2026-10-22 用户确认新图案（房子/两个人头），取代任务X的互换 ----------
test('Tab图标：首页=房子 home.png、往来=两个人头 wanglai.png（用户确认新图案）', () => {
  const app = JSON.parse(readMp('app.json'));
  const [home, wanglai] = app.tabBar.list;
  assert.eq(home.text, '首页', '第一项文字仍是首页');
  assert.eq(home.pagePath, 'pages/index/index', '第一项路径不变');
  assert.eq(home.iconPath, 'images/tabbar/home.png', '首页用房子新图');
  assert.eq(home.selectedIconPath, 'images/tabbar/home-active.png', '首页选中用房子红图');
  assert.eq(wanglai.text, '往来', '第二项文字仍是往来');
  assert.eq(wanglai.iconPath, 'images/tabbar/wanglai.png', '往来用两个人头新图');
  assert.eq(wanglai.selectedIconPath, 'images/tabbar/wanglai-active.png', '往来选中用两个人头红图');
  const bar = readMp('components/tab-bar/tab-bar.js');
  assert(bar.includes("text: '首页', icon: '/images/tabbar/home.png'"), '自定义 tab 栏首页图标与 app.json 一致');
  assert(bar.includes("text: '往来', icon: '/images/tabbar/wanglai.png'"), '自定义 tab 栏往来图标与 app.json 一致');
});
