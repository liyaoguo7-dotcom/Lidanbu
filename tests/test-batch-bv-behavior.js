/** BV批：
 * 1 样式按钮：底色＝上留白底色 marginBg ×0.85、字色＝主题墨色、红色去掉；
 * 2 进页延迟：会员与开关并行取、揭盖不再等补充片（补充片后台到了重排）；
 * 3 斑马纹：我的页会员卡下连续交替、往来主列表交替（搜索结果不动）、选联系人页交替；
 * 4 收礼礼薄详情加搜索栏（照送礼记录页本地筛）；
 * 5 往来搜索只出有往来记录的联系人（同名重复根治）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

test('BV 样式按钮：六样式底色＝marginBg×0.85、逐通道确实加深', () => {
  const expect = {
    classic: '#D4C6BB', blue: '#B8C4CD', pear: '#D5D1C9',
    cloud: '#D0C7B1', bamboo: '#BBC9BF', funeral: '#CECECE',
  };
  for (const [id, bg] of Object.entries(expect)) {
    const t = LC.THEMES[id];
    assert.eq(t.styleBtnBg, bg, `${id} 样式按钮底色`);
    const m = hexRgb(t.marginBg);
    const s = hexRgb(t.styleBtnBg);
    assert(s.r <= m.r && s.g <= m.g && s.b <= m.b, `${id} 按钮底色深于上留白底色`);
  }
});

test('BV 样式按钮：WXML 按主题绑定、WXSS 不再写死红字', () => {
  const wxml = readMp('pages/landscape/book.wxml');
  assert(wxml.includes('class="style-btn"'), '样式按钮在位');
  assert(wxml.includes('{{theme.styleBtnBg}}'), '样式按钮底色绑定主题');
  assert(wxml.includes('{{theme.inkColor}}'), '样式按钮字色绑定主题墨色');
  const wxss = readMp('pages/landscape/book.wxss');
  const block = wxss.match(/\.style-btn \{[^}]*\}/)[0];
  assert(!block.includes('#F0575A'), '样式按钮样式块不再含红字色');
});

test('BV 进页：会员与开关并行取、揭盖不再等补充片', () => {
  const js = readMp('pages/landscape/book-common.js');
  assert(js.includes('Promise.all(['), '存在并行取');
  assert(js.includes('dataService.getMembership()'), '会员并行取');
  assert(!js.includes('BF批（用户要求「不要有延迟」）'), 'BF 等盖块已移除');
  assert(js.includes('BV批（用户定：速度优先）'), 'BV 揭盖注释在位');
});

test('BV 斑马纹已由 BX 统一淡色块取代：任何页面不得残留 zebra 交替', () => {
  const files = [
    'pages/mine/mine.wxml',
    'pages/wanglai/wanglai.wxml',
    'pages/choose-contact/choose-contact.wxml',
    'pages/receive/receive.wxml',
    'pages/gifts/gifts.wxml',
  ];
  for (const f of files) assert(!readMp(f).includes('zebra'), `${f} 无 zebra 残留`);
  assert(!readMp('app.wxss').includes('.zebra'), '全局无 .zebra 定义');
  const wl = readMp('pages/wanglai/wanglai.wxml');
  const searchLine = wl.split('\n').find((l) => l.includes('contact-row') && l.includes('searchResults'));
  assert(searchLine && !searchLine.includes('rowbg'), '往来搜索结果仍不动（搜索结果从未交替，BX 也不铺色）');
});

test('BV 收礼详情：搜索栏＋本地筛＋搜空态', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  assert(wxml.includes('bindinput="onSearchInput"'), '搜索输入在位');
  assert(wxml.includes('bindtap="onCancelSearch"'), '取消在位');
  assert(wxml.includes('wx:for="{{shown}}"'), '列表按筛后渲染');
  assert(wxml.includes('没有找到相关记录'), '搜空态在位');
  const js = readMp('pages/receive-detail/receive-detail.js');
  assert(js.includes('applyFilter()'), '筛函数在位');
  assert(js.includes('r.name.includes(kw)'), '本地按姓名筛');
});

test('BV 我的页会员卡片红稍淡已由 BX 六色取代：渐变改送礼粉红（深色在上）、开通会员白底红字不动', () => {
  const wxss = readMp('pages/mine/mine.wxss');
  assert(wxss.includes('linear-gradient(135deg, #F78C8F, #FFC7C3)'), '会员卡片渐变已改送礼粉红');
  assert(wxss.includes('.m-btn') && /\.m-btn\s*\{[^}]*color: #F0575A/.test(wxss), '开通会员白底红字不动');
});

test('BV 送礼记录列表交替已由 BX 统一淡色块取代：行统铺色且保留 last', () => {
  const wxml = readMp('pages/gifts/gifts.wxml');
  assert(wxml.includes(`class="gift-row rowbg {{index === shown.length - 1 ? 'last' : ''}}"`), '送礼行统铺色且保留 last');
  assert(readMp('pages/gifts/gifts.wxss').includes('.gift-row {'), '送礼行样式在位');
});

test('BV 礼薄详情头部底色：头部单层底色、记录列表不动、白事淡灰', () => {
  const wxml = readMp('pages/receive-detail/receive-detail.wxml');
  assert(wxml.includes('class="pat-head {{isBaishi ? \'baishi\' : \'\'}}"'), '头部包一层 pat-head');
  const headStart = wxml.indexOf('pat-head');
  const recStart = wxml.indexOf('rec-row');
  assert(headStart > 0 && headStart < recStart, '头部层在记录行之前');
  assert(wxml.indexOf('total-line') > 0 && wxml.indexOf('total-line') < headStart, '共计在冻结区内（CR批：从头部层移入搜索框下冻结区，不再头部层内）');
  const wxss = readMp('pages/receive-detail/receive-detail.wxss');
  assert(wxss.includes('.pat-head { background: #F7F3EA;'), '喜事头部淡米');
  assert(wxss.includes('.pat-head.baishi { background: #F2F2F2; }'), '白事头部淡灰');
});

test('BV 往来搜索：同名两人只有有记录的出结果', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1', { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
  const cA = await core.contacts.createContact(db, owner, owner, { name: '马小娟' });
  await core.contacts.createContact(db, owner, owner, { name: '马小娟' });
  await core.contacts.createContact(db, owner, owner, { name: '马小娟亲戚' });
  await core.gifts.createGift(db, owner, owner, { contactId: cA._id, tagId: 'qita', amount: 10000, date: '2026-10-28' });
  const res = await core.contacts.searchContactsWithRecords(db, owner, owner, '马小娟');
  assert.eq(res.length, 1, '只剩有记录的一条');
  assert.eq(res[0]._id, cA._id, '剩的是有记录的那个');
  const old = await core.contacts.searchContacts(db, owner, owner, '马小娟');
  assert(old.length >= 2, '旧搜索仍全量（契约未改）');
});

test('BV 往来搜索：只有收礼记录的也保留', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'owner1', { status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
  const cD = await core.contacts.createContact(db, owner, owner, { name: '周涛' });
  const ev = await core.receive.createEvent(db, owner, owner, { name: '周涛的婚宴', tagId: 'jiehun', date: '2026-10-28' });
  await core.receive.createRecord(db, owner, owner, ev._id, { contactId: cD._id, amount: 50000, type: '现金', date: '2026-10-28' });
  const res = await core.contacts.searchContactsWithRecords(db, owner, owner, '周涛');
  assert.eq(res.length, 1, '收礼记录保留');
});
