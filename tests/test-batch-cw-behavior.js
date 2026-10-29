/** CW批（用户 2026-10-29 定）：亲友录联系人弹窗字体大一档、全部居中——
 * 选项 15px 改 17px（＝原姓名大小），姓名 17px 改 19px（比选项大一档）；
 * 删除栏把提示小字收进同一栏、整栏仍 58px（提示另起一行也算进删除高度）；
 * 取消改红底白字胶囊按钮（行高仍 58px、按钮 44px 居中、左右留边）；
 * 弹窗底部多垫的 20px 留白去掉、只留安全区，取消那截不再比其他行高。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CW 联系人弹窗字体大一档＋删除栏含提示＋取消红胶囊', () => {
  const wxss = readMp('pages/contacts/contacts.wxss');
  const wxml = readMp('pages/contacts/contacts.wxml');
  assert(wxss.includes('.sname { text-align: center; font-size: 19px;'), '姓名 19px、比选项大一档、居中');
  assert(wxss.includes('.sopt { text-align: center; height: 58px; line-height: 58px; font-size: 17px;'), '选项 17px（＝原姓名大小）、行高 58px、居中');
  assert(wxml.includes('class="sopt del"') && wxml.includes('class="del-text">删除姓名</view>') && wxml.includes('class="del-note">数据无价，谨慎删除</view>'), '删除文字＋提示收进同一栏');
  assert(!wxml.includes('class="snote"'), '栏外单独的提示行已去掉');
  assert(wxss.includes('.sopt.del { display: flex; flex-direction: column; align-items: center; justify-content: center;'), '删除栏两行上下排、整栏居中（整栏仍 58px，见 .sopt 高度）');
  assert(wxss.includes('.del-note { font-size: 12px; color: #C2C2C2;'), '提示小字灰色 12px');
  assert(wxml.includes('class="cancel-btn">取消</view>'), '取消是胶囊按钮');
  assert(wxss.includes('.cancel-btn { flex: 1; margin: 0 32px; height: 44px; line-height: 44px;') && wxss.includes('color: #fff; background: #F0575A; border-radius: 22px;'), '取消胶囊：红底白字、44px、左右留边 32px、半圆角');
  assert(wxss.includes('.sopt.cancel { display: flex; align-items: center; justify-content: center;'), '取消行 58px、按钮行里居中');
  assert(!wxss.includes('padding-bottom: calc(20px + env(safe-area-inset-bottom))'), '弹窗底部多垫的 20px 留白已去掉');
  assert(wxss.includes('padding-bottom: env(safe-area-inset-bottom);'), '弹窗底部只留安全区');
  assert(wxss.includes('.sopt.red { color: #F0575A; }'), '往来记录红字不动');
});
