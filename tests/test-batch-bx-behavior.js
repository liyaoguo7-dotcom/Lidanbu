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
  assert(readMp('pages/receive/receive.wxss').includes('.event-row.rowbg { background: linear-gradient(135deg, #FFE4B8, #FDBE68); }'), '收礼行整块橙黄渐变提权覆盖（DN批：BX 淡色作废）');
  assert(!readMp('pages/gifts/gifts.wxml').includes('class="gift-row rowbg'), '送礼行不再统铺色（CT批：恢复纯白）');
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
  // 2026-10-31 用户定：DG 红渐变作废，会员卡改首页送礼右边浓粉红 #F78C8F 纯色不渐变
  assert(wxss.includes('background: #F78C8F;'), '会员卡片已改送礼右边浓粉红纯色（2026-10-31）');
  assert(/\.m-btn\s*\{[^}]*color: #F0575A/.test(wxss), '开通会员白底红字不动');
});

test('BX 六色搭配：往来时间按钮／对照块／差额条、亲友录字母行、我的页头像栏与卡内按钮', () => {
  const wl = readMp('pages/wanglai/wanglai.wxss');
  const chips = [['chip-all', '#E2EEFB'], ['chip-today', '#FDE8E8'], ['chip-month', '#FDEFCB'], ['chip-year', '#E0F3E4'], ['chip-lastYear', '#FFC7C3'], ['chip-custom', '#FFE4B8']];
  for (const [cls, bg] of chips) assert(wl.includes(`.tchip.${cls} { background: ${bg}; }`), `时间按钮 ${cls} 配 ${bg}`);
  assert(readMp('pages/wanglai/wanglai.wxml').includes('chip-{{item.id}}'), '时间按钮按 id 挂色');
  assert(wl.includes('.tchip.on { color: #E05353; border-color: #E05353; }'), '选中态红字红边不变');
  assert(wl.includes('.side:first-child { background: linear-gradient(135deg, #FFC7C3, #F78C8F); }') && wl.includes('.side:last-child { background: linear-gradient(135deg, #FFE4B8, #FDBE68); }'), '收送块底色（CP批首页两渐变＋CS批左送礼右收礼）');
  assert(wl.includes('.summary-card {') && wl.includes('background: #FBF3D9;'), '合计＋差额合并卡本月淡黄（CD批）');
  const ct = readMp('pages/contacts/contacts.wxss');
  for (let i = 0; i < 6; i++) assert(ct.includes(`.group-title.c${i} { background: rgba(253, 239, 203, 0.6); }`), `字母行 c${i} 米色（DD批：暗灰改回）`);
  assert(readMp('pages/contacts/contacts.wxml').includes('group-title c{{gi % 6}}'), '字母行绑定不动，只改色值');
  assert(ct.includes('margin: 10px 0;') && !ct.slice(ct.indexOf('.card {'), ct.indexOf('.group-title {')).includes('border-radius'), '亲友录卡只动左右边距（2026-10-31 用户纠正，其他不动）');
  const mine = readMp('pages/mine/mine.wxss');
  // 2026-10-31 用户定：DG 橙黄渐变作废，头像栏改首页收礼左边 #FFE4B8 半透明淡黄纯色不渐变
  assert(mine.includes('.card.profile { background: rgba(255, 228, 184, 0.6); }'), '头像栏收礼左边半透明淡黄纯色（2026-10-31）');
  assert(mine.includes('.m-badge {') && mine.includes('background: #E2EEFB; color: #333;'), '会员有效家庭共享蓝＋深字（CF批）');
  assert(mine.includes('.m-btn.ghost {') && mine.includes('background: #E0F3E4; color: #333;'), '我的积分导出备份绿＋深字');
});

test('BX 送礼页冻结：搜索栏贴顶、共计贴在搜索栏下方、白底盖住滚动行', () => {
  const wxss = readMp('pages/gifts/gifts.wxss');
  assert(wxss.includes('.gifts-page { display: flex; flex-direction: column; height: 100vh;'), 'CT批取代 BX sticky：固定头＋独立滚动（仿往来页）');
  assert(!wxss.includes('position: sticky'), 'CT批：本页不再有任何 sticky（固定头＋滚动区，不再从块下面冒字）');
});

/* CG批（用户 2026-10-29 定）取代 BX 一体冻结：搜索框＋礼薄名一行固定贴顶，头像头滚动；断言见 test-batch-cg-behavior.js，本块删除。 */
