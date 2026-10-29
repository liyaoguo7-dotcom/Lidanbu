/** CX批（用户 2026-10-29 定）：购买页会员权益文案去掉「记账额度不限量」。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CX 购买页会员权益文案去掉记账额度不限量', () => {
  const wxml = readMp('pages/member/purchase/purchase.wxml');
  assert(!wxml.includes('记账额度不限量'), '购买页不再有记账额度不限量');
  assert(wxml.includes('会员权益：横置礼单本（6 种样式 · 6 种字体）· 拍照录入 · 家庭共享邀请</view>'), '权益文案以家庭共享邀请结尾、无多余分隔符');
});
