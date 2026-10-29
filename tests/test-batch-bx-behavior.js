/** BX批：
 * 1 斑马交替取消：各处改为统一淡色块（更淡一档 #FBF8F0，用户嫌原斑马米偏暗）；
 * 2 联系人字体大一号（横置不动）：16px→17px，往来本来 17px→18px，核对页姓名 15px→16px；
 * 3 会员卡片换偏粉色渐变；
 * 4 送礼页：搜索栏＋共计行冻结不滚动；
 * 5 礼薄详情页：搜索栏＋头像头冻结为一体、中间无灰底、头像上移。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');

test('BX 统一淡色块：全局色更淡、各处行统铺色、无交替绑定残留', () => {
  assert(readMp('app.wxss').includes('.rowbg { background: #FBF8F0; }'), '全局统一淡色 #FBF8F0');
  const mine = readMp('pages/mine/mine.wxml');
  for (const h of ['onLandscapeToggle', 'onInviteReward', 'onDemoMembership', 'onNotifications', 'onFeedback', 'onFaq', 'onAbout']) {
    const line = mine.split('\n').find((l) => l.includes(h));
    assert(line && line.includes('rowbg'), `我的页 ${h} 行铺色`);
  }
  assert(mine.includes('contact-btn rowbg'), '联系客服行铺色');
  assert(readMp('pages/mine/mine.wxss').includes('.contact-btn.rowbg { background: #FFFFFF; }'), '联系客服白底提权覆盖（CD批：我的页以下各行纯白）');
  assert(readMp('pages/wanglai/wanglai.wxml').includes('class="wl-row rowbg"'), '往来主列表行统铺色');
  assert(readMp('pages/choose-contact/choose-contact.wxml').includes('class="contact-row rowbg"'), '选联系人行统铺色');
  assert(readMp('pages/receive/receive.wxml').includes('class="event-row rowbg"'), '收礼礼簿行统铺色');
  assert(readMp('pages/receive/receive.wxss').includes('.event-row.rowbg { background: #FBF8F0; }'), '收礼行白底提权覆盖');
  assert(readMp('pages/gifts/gifts.wxml').includes('class="gift-row rowbg'), '送礼行统铺色');
  for (const f of ['pages/mine/mine.wxml', 'pages/wanglai/wanglai.wxml', 'pages/choose-contact/choose-contact.wxml', 'pages/receive/receive.wxml', 'pages/gifts/gifts.wxml']) {
    assert(!readMp(f).includes('% 2 === 1'), `${f} 无交替绑定残留`);
  }
  assert(readMp('pages/wanglai/wanglai.wxss').includes('.wl-card { overflow: hidden; }'), '往来主列表卡裁溢出贴合圆角');
  assert(readMp('pages/gifts/gifts.wxss').includes('.card.list-card { margin-top: 0; overflow: hidden; }'), '送礼卡裁溢出贴合圆角');
});

test('BX 联系人字体大一号：各页人名＋1px，横置不动、礼薄名不动', () => {
  assert(readMp('pages/contacts/contacts.wxss').includes('.nm { font-size: 17px; }'), '亲友录人名 16→17');
  assert(readMp('pages/choose-contact/choose-contact.wxss').includes('.nm { font-size: 17px; }'), '选联系人人名 16→17');
  assert(readMp('pages/gifts/gifts.wxss').includes('.nm { font-size: 17px;'), '送礼人名 16→17');
  assert(readMp('pages/receive-detail/receive-detail.wxss').includes('.nm { font-size: 17px;'), '收礼详情人名 16→17');
  assert(readMp('pages/index/index.wxss').includes('.recent-name { font-size: 17px;'), '首页最近往来人名 16→17');
  assert(readMp('pages/mine/mine.wxss').includes('.form-val { font-size: 17px; }'), '我的页行文字 16→17（曾与联系人字号统一）');
  assert(readMp('pages/wanglai/wanglai.wxss').includes('font-size: 18px;'), '往来人名 17→18');
  assert(readMp('pages/wanglai/wanglai.wxss').includes('.contact-row .nm { font-size: 18px;'), '往来搜索结果人名 17→18');
  const review = readMp('pages/import/import-review.wxml');
  assert(review.includes('class="form-val name-val"'), '核对页姓名输入单加 name-val');
  assert(readMp('pages/import/import-review.wxss').includes('.name-val { font-size: 16px; }'), '核对页姓名 15→16（金额／类型共用 .form-val 不动）');
  assert(readMp('pages/receive/receive.wxss').includes('.nm { font-size: 16px;'), '收礼礼簿名不是联系人，仍 16px 不动');
});

test('BX 会员卡片偏粉色已由六色取代：渐变改送礼粉红（深色在上）、开通会员白底红字不动', () => {
  const wxss = readMp('pages/mine/mine.wxss');
  assert(wxss.includes('linear-gradient(135deg, #F78C8F, #FFC7C3)'), '会员卡片渐变送礼粉红');
  assert(/\.m-btn\s*\{[^}]*color: #F0575A/.test(wxss), '开通会员白底红字不动');
});

test('BX 六色搭配：往来时间按钮／对照块／差额条、亲友录字母行、我的页头像栏与卡内按钮', () => {
  const wl = readMp('pages/wanglai/wanglai.wxss');
  const chips = [['chip-all', '#E2EEFB'], ['chip-today', '#FDE8E8'], ['chip-month', '#FDEFCB'], ['chip-year', '#E0F3E4'], ['chip-lastYear', '#FFC7C3'], ['chip-custom', '#FFE4B8']];
  for (const [cls, bg] of chips) assert(wl.includes(`.tchip.${cls} { background: ${bg}; }`), `时间按钮 ${cls} 配 ${bg}`);
  assert(readMp('pages/wanglai/wanglai.wxml').includes('chip-{{item.id}}'), '时间按钮按 id 挂色');
  assert(wl.includes('.tchip.on { color: #E05353; border-color: #E05353; }'), '选中态红字红边不变');
  assert(wl.includes('.side {') && wl.includes('background: #FDE8E8;'), '收送块今日粉（CE批：收送同色；CJ批底色收进 .side）');
  assert(wl.includes('.summary-card {') && wl.includes('background: #FBF3D9;'), '合计＋差额合并卡本月淡黄（CD批）');
  const ct = readMp('pages/contacts/contacts.wxss');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: rgba(253, 239, 203, 0.6); }`), `字母行 c${i} 统一透明淡黄（CK修正，取代 CK 实色淡黄）`);
  assert(readMp('pages/contacts/contacts.wxml').includes('group-title c{{gi % 6}}'), '字母行绑定不动，只改色值');
  assert(ct.includes('.card { overflow: hidden; }'), '亲友录卡裁溢出贴合圆角');
  const mine = readMp('pages/mine/mine.wxss');
  assert(mine.includes('.card.profile { background: #FDEFCB; }'), '头像栏会员有效黄（CF批：与会员有效对换）');
  assert(mine.includes('.m-badge {') && mine.includes('background: #E2EEFB; color: #333;'), '会员有效家庭共享蓝＋深字（CF批）');
  assert(mine.includes('.m-btn.ghost {') && mine.includes('background: #E0F3E4; color: #333;'), '我的积分导出备份绿＋深字');
});

test('BX 送礼页冻结：搜索栏贴顶、共计贴在搜索栏下方、白底盖住滚动行', () => {
  const wxss = readMp('pages/gifts/gifts.wxss');
  assert(wxss.includes('.searchbar { padding-bottom: 0; position: sticky; top: 0; z-index: 10; background: #F6F6F6; }'), '搜索栏 sticky 贴顶＋页灰底');
  assert(wxss.includes('.total-line { position: sticky; top: 44px; z-index: 9; background: #fff; }'), '共计行 sticky 在搜索栏下方（搜索栏高 44px）＋白底');
});

/* CG批（用户 2026-10-29 定）取代 BX 一体冻结：搜索框＋礼薄名一行固定贴顶，头像头滚动；断言见 test-batch-cg-behavior.js，本块删除。 */
