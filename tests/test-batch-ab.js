/**
 * 任务AB（真机反馈第五批）测试：
 * 1 横置渲染字号封顶中段字号（四种字体状态 ≤22、默认字数 =22）；
 * 2 列宽 56；3 姓名/金额墨色加深；4 Tab 图标重绘（无圈、颜色对齐、162×162）；
 * 5 自定义 Tab 栏图标 27px/栏高 50px；6 字体三修（标记键带版本段、app 预下载分包、book 加载后重排）；
 * 7 邀请静默预生成（页面级断言在 test-batch-x 修订）；8 小喇叭改版（无闪、慢速左滚、hornMarquee 纯函数）；
 * 9 中段词颜色逐样式加深（白事仍无红）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const { hornMarquee, estimateWidth } = require('../miniprogram/services/horn-marquee.js');

// ---------- 1 字号封顶 ----------
test('任务AB-1字号封顶：四种字体状态姓名/金额 CSS 字号 ≤22、默认字数 =22', () => {
  for (const fid of ['lxgw', 'mashanzheng', 'longcang', 'default']) {
    const built = LC.buildColumns(
      [{ id: 'x', name: '张建国', amountFen: 100000, tagId: 'jiehun' }], { fontId: fid });
    const col = built.columns[0];
    assert(col.nameFontSize <= LC.SPEC.MID_FONT, `${fid} 姓名字号 ${col.nameFontSize} 不得超过中段 ${LC.SPEC.MID_FONT}`);
    assert(col.amountFontSize <= LC.SPEC.MID_FONT, `${fid} 金额字号 ${col.amountFontSize} 不得超过中段`);
    assert.eq(col.nameFontSize, 22, `${fid} 3 字名默认字号 =22`);
    assert.eq(col.amountFontSize, 22, `${fid} 4 字金额默认字号 =22`);
    // 多字缩字后仍 ≤22
    const big = LC.buildColumns(
      [{ id: 'y', name: '欧阳修远明', amountFen: 150000, tagId: 'jiehun' }], { fontId: fid });
    assert(big.columns[0].nameFontSize <= 22, `${fid} 5 字名缩后 ≤22`);
    assert(big.columns[0].amountFontSize <= 22, `${fid} 6 字金额缩后 ≤22`);
  }
  // 校准仍在内部：renderFontSize 对龙藏 22 名义值应封顶（裸校准为 26.4）
  assert(Math.abs(LC.calibratedSize(22, 'longcang') - 26.4) < 0.01, '校准值本身不变（内部防叠用）');
  assert.eq(LC.renderFontSize(22, 'longcang'), 22, '渲染字号封顶 22');
  assert.eq(LC.renderFontSize(22, 'lxgw'), 22, '文楷渲染 22');
});

// ---------- 2/3/9 横置版式与颜色 ----------
test('任务AB-2/3/9横置：列宽（AC 改 50）、墨色加深、中段色逐样式加深且白事无红', () => {
  assert.eq(LC.SPEC.COL_W, 50, '列宽 50（AB 定 56，任务AC 第 9 项再窄到 50）');
  for (const id of ['classic', 'blue', 'pear', 'cloud', 'bamboo']) {
    assert.eq(LC.THEMES[id].inkColor, '#262019', `${id} 姓名/金额墨色深褐黑`);
  }
  assert.eq(LC.THEMES.funeral.inkColor, '#2E3237', '白事墨色深灰');
  assert.eq(LC.THEMES.classic.midColor, '#9E2A22', '传统经典中段深红');
  assert.eq(LC.THEMES.pear.midColor, '#9E2A22', '梨花白中段深红');
  assert.eq(LC.THEMES.blue.midColor, '#3D6A8F', '淡蓝中段深蓝');
  assert.eq(LC.THEMES.cloud.midColor, '#8A6520', '祥云金中段深金');
  assert.eq(LC.THEMES.bamboo.midColor, '#33684C', '竹青中段深绿');
  assert.eq(LC.THEMES.funeral.midColor, '#15181B', '白事中段深灰');
  assert.eq(LC.THEMES.funeral.noRed, true, '白事仍守无红');
  assert(readMp('pages/landscape/book.wxml').includes("item.midBlack ? '#15181B'"), '送礼页奠仪列中段色同步加深');
});

// ---------- 4 Tab 图标重绘 ----------
test('任务AB-4Tab图标：无外圈、162×162 透明底（颜色口径已被任务AC 第 1 项更新，见 test-batch-ac）', () => {
  const srcDir = path.join(__dirname, '..', 'docs', 'tab-icon-sources');
  const house = fs.readFileSync(path.join(srcDir, 'home-house.svg'), 'utf8');
  assert(house.includes('#535353'), '房子未选色 #535353（任务AC 实测基准：亲友录/我的 PNG 主色）');
  assert(!house.includes('#404040'), '房子不得再用旧深灰 #404040');
  const people = fs.readFileSync(path.join(srcDir, 'wanglai-people.svg'), 'utf8');
  assert(!people.includes('r="226"'), '两人头 SVG 不得有外圈（r=226 的描边圆）');
  assert(people.includes('#535353'), '两人头未选色 #535353');
  const houseA = fs.readFileSync(path.join(srcDir, 'home-house-active.svg'), 'utf8');
  const peopleA = fs.readFileSync(path.join(srcDir, 'wanglai-people-active.svg'), 'utf8');
  assert(houseA.includes('#F45A5A') && peopleA.includes('#F45A5A'), '选中色 #F45A5A（亲友录/我的选中态实测主色）');
  for (const n of ['home', 'home-active', 'wanglai', 'wanglai-active']) {
    const buf = fs.readFileSync(path.join(MP, 'images/tabbar', `${n}.png`));
    assert.eq(buf.readUInt32BE(16), 162, `${n}.png 宽 162`);
    assert.eq(buf.readUInt32BE(20), 162, `${n}.png 高 162`);
  }
});

// ---------- 5 自定义 Tab 栏尺寸 ----------
test('任务AB-5Tab栏：栏高 50px、颜色与 app.json 一致（图标/字号已被任务AC 第 2 项更新，见 test-batch-ac）', () => {
  const wxss = readMp('components/tab-bar/tab-bar.wxss');
  assert(wxss.includes('.tabbar-icon { width: 30px; height: 30px; }'), '图标 30px（AC 第 2 项按原生截图校准）');
  assert(wxss.includes('height: 50px'), '栏高 50px');
  assert(wxss.includes('.tabbar-text { font-size: 13px;'), '文字 13px（AC 第 2 项）');
  const wxml = readMp('components/tab-bar/tab-bar.wxml');
  assert(wxml.includes("'#F0575A'") && wxml.includes("'#404040'"), '选中/未选色与 app.json tabBar 一致');
});

// ---------- 6 字体三修 ----------
test('任务AB-6字体：已加载标记带构建版本段、app 启动预下载 fonts 分包、book 加载成功后重排', () => {
  const fm = require('../miniprogram/services/font-manager.js');
  assert(fm.FONT_BUILD === 'v4', '字体构建版本号 v4（任务AE 路线变更再 bump）');
  assert(fm.LOADED_KEY_PREFIX === 'landscape.fontLoaded.v4.', '标记键带版本段，旧键自然失效');
  const app = readMp('app.js');
  assert(app.includes('wx.preDownloadSubpackage'), 'app.js 应预下载分包');
  assert(app.includes("name: 'fonts'"), '预下载的正是 fonts 分包');
  assert(app.includes("typeof wx.preDownloadSubpackage === 'function'"), '预下载前先判 API 存在（不存在静默跳过）');
  const book = readMp('pages/landscape/book-common.js');
  assert(book.includes('if (ok) this._convertCols();'), 'book 页字体加载成功后强制重排一次');
});

// ---------- 8 小喇叭改版 ----------
test('任务AB-8喇叭判定：短文字不滚、长文字慢滚且时长按 30px/秒', () => {
  const short = hornMarquee('左右滑动查看更多');
  assert.eq(short.run, false, '短文字不滚');
  const longText = '对着原图逐条核对：姓名可以从亲友录选，金额、类型、日期、备注都能改；错的删掉，不够再补录。全部改好点底部"全部确认导入"，一次写进账本。';
  const long = hornMarquee(longText);
  assert.eq(long.run, true, '长文字应滚动');
  const speed = (long.width + 48) / long.dur;
  assert(Math.abs(speed - 30) < 1.5, `滚动速度约 30px/秒（实际 ${speed.toFixed(1)}）`);
  assert.eq(estimateWidth('中文'), 24, '全角字按字号计宽');
  assert.eq(estimateWidth('ab'), 13, '半角字按 0.55 倍字号计宽（取整）');
});

test('任务AB-8喇叭实现：全仓无闪烁、8 处实例均为慢滚结构、淡黄底与内存关闭保留', () => {
  const app = readMp('app.wxss');
  assert(!app.includes('hornBlink') && !app.includes('horn-blink'), 'app.wxss 无闪烁动画');
  assert(app.includes('@keyframes hornScroll') && app.includes('.horn-track.run'), 'app.wxss 有慢滚轨道动画');
  assert(app.includes('background: #FFF8E1;'), '淡黄底保留');
  const tipPages = ['pages/index/index.wxml', 'pages/contacts/contacts.wxml', 'pages/choose-contact/choose-contact.wxml',
    'pages/import/import-home.wxml', 'pages/import/import-event.wxml', 'pages/import/import-review.wxml'];
  for (const p of tipPages) {
    const w = readMp(p);
    assert(w.includes('horn-track') && w.includes('hornRun') && w.includes('hornDur'), `${p} 为慢滚结构`);
    assert(!w.includes('horn-blink') && !w.includes('hornWide') && !w.includes('scroll-x'), `${p} 无闪烁/点开滑动残留`);
  }
  const recv = readMp('pages/receive/receive.wxml');
  assert(recv.includes('horn-track') && !recv.includes('horn-blink'), '收礼页喇叭为慢滚结构');
  const tbw = readMp('components/tip-bar/tip-bar.wxml');
  const tbx = readMp('components/tip-bar/tip-bar.wxss');
  const tbj = readMp('components/tip-bar/tip-bar.js');
  assert(tbw.includes('horn-track') && !tbw.includes('horn-blink') && !tbw.includes('expanded'), 'tip-bar 为慢滚结构、无展开态');
  assert(!tbx.includes('hornBlink') && tbx.includes('@keyframes hornScroll'), 'tip-bar 样式隔离内只有慢滚动画');
  assert(tbj.includes('hornMarquee') && tbj.includes('hornState.dismiss'), 'tip-bar 接慢滚判定且关闭仍走内存状态');
});
