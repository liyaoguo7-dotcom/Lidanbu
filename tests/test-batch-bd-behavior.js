/**
 * BD批行为测试（2026-10-27 用户看横置截图后亲定）：
 * ①右半边无线空白改法：每本固定 15 列（暂定）、纸面定宽居中、卷轴
 *   两侧内收（离屏幕边缘留出留白纹），不再按屏宽拉满；
 * ②字体选择面板只显示字体名字，去掉「张三 壹仟元整」预览字；
 * ③枝芒行学校准 1.16→1.24（「有点小、大一号」）；补充字库底本按用户
 *   选定换枝芒行书、字形同口径放大。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');

const rd = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('BD/BG书体定版：每本固定 14 列、空本也排满 14 列（BD 定 15，BG 用户改定 14）', () => {
  assert.eq(LC.SPEC.BOOK_COLS, 14, 'BOOK_COLS 定版 14（BG批）');
  assert.eq(LC.buildColumns([], {}).totalGrid, 14, '空本 14 列');
  assert.eq(
    LC.buildColumns([{ id: 'a', name: '张三', amountFen: 100, tagId: 'jiehun' }], {}).emptyCount,
    13, '1 条记录补 13 空列',
  );
});

test('BD纸面定宽居中：midrow 绑定 bookW（14 列宽＋双槽）', () => {
  const wxml = rd('miniprogram/pages/landscape/book.wxml');
  assert(wxml.includes('class="midrow" style="width:{{view.bookW}}px;align-self:center;transform:translateX({{view.bookShiftX}}px);"'), 'midrow 定宽居中＋BG 真居中平移');
  const common = rd('miniprogram/pages/landscape/book-common.js');
  assert(common.includes('LC.SPEC.BOOK_COLS * this.data.spec.colW'), 'bookW 按 BOOK_COLS 列×列宽＋双槽算');
});

test('BD字体面板只留名字：无预览字「张三 壹仟元整」', () => {
  const wxml = rd('miniprogram/pages/landscape/book.wxml');
  assert(!wxml.includes('font-preview'), 'font-preview 已移除');
  assert(!wxml.includes('张三 壹仟元整'), '预览样字已移除');
  assert(wxml.includes('{{item.name}}'), '字体名保留');
});

test('BD枝芒大一号＋补充底本枝芒：校准 1.32、补充族名/文件名一致', () => {
  assert.eq(LC.fontById('zhimang').calibration, 1.32, '枝芒校准 1.32（CQ批再大一点，取代 1.24）');
  assert.eq(LC.SUPP_FONTS.length, 12, '补充 12 片（BT批）');
  assert.eq(LC.SUPP_FONTS[0].family, 'ZhiMangSupp1', '补充族名以枝芒为底');
  assert.eq(LC.SUPP_FONTS[5].cloudFile, 'zhimang-supp6.ttf', '补充云端文件名');
  const stack = LC.selectedStack('bakudai');
  assert(stack.includes('"ZhiMangSupp1"') && stack.includes('"ZhiMangSupp12"'), '莫大回退链含枝芒补充 12 片（BU批：毛笔组）');
  const stackLx = LC.selectedStack('lxgw');
  assert(stackLx.includes('"LxgwSupp1"') && stackLx.includes('"LxgwSupp12"'), '霞鹜回退链含霞鹜补充 12 片（BU批：印刷组）');
});
