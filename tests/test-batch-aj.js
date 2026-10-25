/* AJ批：横置礼单本半屏详情的「删除」改走竖屏（2026-10-25 用户定：查看往来/修改都跳竖屏，
   删除也须跳竖屏详情页操作，横屏内不再弹删除确认弹窗） */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');
const read = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

function run() {
  const js = read('pages/landscape/book-common.js');
  const del = js.match(/onDetailDelete\(\) \{[\s\S]*?\n    \},/)[0];
  assert(del.includes('/pages/gift-detail/gift-detail?id='), '送礼删除须跳竖屏送礼详情页');
  assert(del.includes('/pages/receive-record-detail/receive-record-detail?id='), '收礼删除须跳竖屏收礼记录详情页');
  assert(del.includes('wx.navigateTo'), '删除须走页面跳转');
  assert(!js.includes('onConfirmDel') && !js.includes('showDelModal'), '横屏内删除弹窗逻辑须移除干净');
  const wxml = read('pages/landscape/book.wxml');
  assert(!wxml.includes('confirm-modal'), '横置模板不得再挂删除确认弹窗');
  // 竖屏两个详情页的删除能力仍在（跳转目标可靠）
  assert(read('pages/gift-detail/gift-detail.js').includes('deleteGift'), '竖屏送礼详情须能删');
  assert(read('pages/receive-record-detail/receive-record-detail.js').includes('deleteRecord'), '竖屏收礼记录详情须能删');
}
run();
console.log('test-batch-aj OK');
