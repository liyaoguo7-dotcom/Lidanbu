/**
 * 任务AA（真机反馈第四批）测试：
 * 1 横置三修：列序按创建升序（第一笔最左）+ 两条取数路径接线、中段词只剩贺礼/奠仪、
 *   金额字形盒底锚、三段绝对定位落位（区顶/区中/区底由 book.wxml+wxss 钉死）；
 * 2 小喇叭：淡黄底统一（硬闪口径已于任务AB 第 8 项作废，新断言在 test-batch-ab）；
 * 3 宋体清零：miniprogram 内 Songti 仅剩横置贺礼/奠仪机制；
 * 4 首页：最近往来取 10 条、>4 条竖向滚动 swiper、大卡下移、字号放大；
 * 5 Tab 图标：162×162（任务AB 第 4 项已重绘为无圈版，新断言在 test-batch-ab）；
 * 6 开通会员页：导出按钮删除、标题不折行样式；
 * 7 字体专项：三款字体内部族名与声明族名一致、均为真 woff2。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');

// ---------- 1a 列序 ----------
test('任务AA-列序：orderForBook 按创建升序，第一笔在最左', () => {
  const recs = [
    { id: 'c', createdAt: 300 }, { id: 'a', createdAt: 100 }, { id: 'b', createdAt: 200 },
  ];
  assert.eq(LC.orderForBook(recs).map((r) => r.id).join(','), 'a,b,c', '升序排列');
  // 同毫秒并列：保持原始录入顺序（稳定排序）
  const tie = [{ id: 'x', createdAt: 5 }, { id: 'y', createdAt: 5 }, { id: 'z', createdAt: 1 }];
  assert.eq(LC.orderForBook(tie).map((r) => r.id).join(','), 'z,x,y', '同刻保持录入序');
  // 不改原数组
  assert.eq(recs[0].id, 'c', '原数组不被修改');
  const built = LC.buildColumns(LC.orderForBook([
    { id: '1', name: '张三', amountFen: 10000, tagId: 'jiehun', createdAt: 3 },
    { id: '2', name: '李四', amountFen: 10000, tagId: 'jiehun', createdAt: 1 },
    { id: '3', name: '王五', amountFen: 10000, tagId: 'jiehun', createdAt: 2 },
  ]), {});
  assert.eq(built.columns.map((c) => c.name).filter(Boolean).join(','), '李四,王五,张三', '渲染列序=记账先后（空格补在最后）');
});

test('任务AA-列序接线：书页两条取数路径都过 orderForBook', () => {
  const bc = readMp('pages/landscape/book-common.js');
  assert(bc.includes('LC.orderForBook(rawGifts)') && bc.includes('dataService.listGiftsFor('), '送礼本路径接线（2026-10-24 提速：与联系人表并发取后仍过 orderForBook）');
  assert(bc.includes('LC.orderForBook(await dataService.listRecordsFor('), '收礼本路径接线');
});

// ---------- 1b/1c 金额底锚 + 三段定位 ----------
test('任务AA-金额底锚：任意字数末字字形盒下缘=金额区高', () => {
  for (const fen of [100, 1000, 10000, 100000, 150000, 1234567]) {
    const a = LC.layoutAmount(fen);
    const last = a.chars[a.chars.length - 1];
    assert(Math.abs(last.top + a.fontSize - LC.SPEC.AMT_H) < 0.011,
      `${fen} 分末字贴底（top=${last.top} fontSize=${a.fontSize}）`);
    assert(a.chars[0].top >= -0.001, '首字不越区顶');
  }
  const spec = LC.scaledSpec(842);
  assert(Math.abs(spec.amtBottomPad - LC.SPEC.AMT_BOTTOM_PAD) < 0.011, 'scaledSpec 输出金额区下偏（842 基准下与 SPEC 一致）');
});

test('任务AA-三段落位：book 模板三段绝对定位（姓名顶/中段正中/金额底）', () => {
  const wxml = readMp('pages/landscape/book.wxml');
  const wxss = readMp('pages/landscape/book.wxss');
  assert(wxml.includes('zone zone-name') && wxml.includes('top:{{spec.nameTop}}px;height:'), '姓名区钉列顶');
  assert(wxml.includes('zone zone-mid'), '中段区存在');
  assert(wxml.includes('zone zone-amt') && wxml.includes('bottom:{{spec.amtBottomPad}}px;height:'), '金额区钉列底（下偏补偿）');
  assert(wxss.includes('.zone { position: absolute;'), '三段绝对定位');
  assert(wxss.includes('.zone-mid { top: 50%; transform: translateY(-50%); }'), '中段区钉列高正中');
  // 中段字在区内居中（buildColumns 既有口径复核）
  const col = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: 'jiehun' }], {}).columns[0];
  const topPad = col.midChars[0].top;
  const botPad = LC.SPEC.MID_H - (col.midChars[col.midChars.length - 1].top + LC.SPEC.MID_FONT);
  assert(Math.abs(topPad - botPad) < 0.011, '中段字区内上下留白一致');
});

// ---------- 1d 中段词 ----------
test('任务AA-中段词：全仓横置链路只剩贺礼/奠仪', () => {
  const src = readMp('pages/landscape/landscape-core.js');
  const midMap = src.match(/const MID_BY_TAG = \{[^}]*\}/)[0];
  assert(!midMap.includes('礼金'), 'MID_BY_TAG 不再产出礼金');
  assert.eq(LC.buildColumns([{ id: '1', name: '张', amountFen: 1, tagId: 'baishi' }], {}).columns[0].midText, '奠仪', '白事→奠仪');
  assert.eq(LC.buildColumns([{ id: '1', name: '张', amountFen: 1, tagId: 'qita' }], {}).columns[0].midText, '贺礼', '其他→贺礼');
});

// ---------- 2 小喇叭（任务AB 第 8 项改版：AA 硬闪口径已作废，细节断言移至 test-batch-ab） ----------
test('任务AA-喇叭：淡黄底统一（闪烁已于任务AB 取消）', () => {
  const app = readMp('app.wxss');
  assert(app.includes('.tip {') && app.includes('background: #FFF8E1;'), '.tip 淡黄底');
  assert(readMp('pages/receive/receive.wxss').includes('background: #FFF8E1;'), '收礼页喇叭淡黄底');
  assert(readMp('components/tip-bar/tip-bar.wxss').includes('background: #FFF8E1;'), 'tip-bar 淡黄底');
  assert(!app.includes('hornBlink') && !app.includes('horn-blink'), 'app.wxss 不得再有硬闪（任务AB 取消闪烁）');
});

// ---------- 3 宋体清零 ----------
test('任务AA-宋体清零：Songti 仅剩 landscape-core 常量（贺礼/奠仪机制）', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'packages') walk(p); continue; }
      if (!/\.(wxss|wxml)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (s.includes('Songti') || s.includes('STSong') || s.includes('SimSun')) {
        hits.push(path.relative(MP, p));
      }
    }
  };
  walk(MP);
  assert.eq(hits.length, 0, `wxss/wxml 不应再有宋体声明，命中：${hits.join(',')}`);
  // wxml 不再有 songti 类（横置 book.wxml 的 songtiStack 变量绑定除外）
  const wxmlHits = [];
  const walk2 = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'packages') walk2(p); continue; }
      if (!e.name.endsWith('.wxml')) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (/class="[^"]*\bsongti\b/.test(s)) wxmlHits.push(path.relative(MP, p));
    }
  };
  walk2(MP);
  assert.eq(wxmlHits.length, 0, `wxml 不应再有 songti 类，命中：${wxmlHits.join(',')}`);
  // 豁免项仍在：中段两词走 songtiStack
  assert(readMp('pages/landscape/book.wxml').includes('font-family:{{songtiStack}}'), '贺礼/奠仪印刷宋体保留');
});

// ---------- 4 首页 ----------
test('任务AA-首页：最近往来取 10 条、竖向滚动 4 条可见、大卡下移、字号放大', () => {
  const js = readMp('pages/index/index.js');
  assert(js.includes('getHomeRecent(10)'), '取最近 10 条');
  assert(js.includes('recentRolling: list.length > 4'), '超过 4 条才滚动');
  const wxml = readMp('pages/index/index.wxml');
  assert(wxml.includes('<swiper') && wxml.includes('vertical="{{true}}"'), '竖向 swiper');
  assert(wxml.includes('autoplay="{{true}}"') && wxml.includes('circular="{{true}}"'), '自动循环滚动');
  assert(wxml.includes('display-multiple-items="4"'), '同时可见 4 条');
  const wxss = readMp('pages/index/index.wxss');
  assert(wxss.includes('.spacer-top { flex: 0.25; }'), '大卡下移（上方配比 0.12→0.25）');
  assert(wxss.includes('.recent-swiper { height: 232px; }'), '滚动区高 = 4×58');
  assert(wxss.includes('height: 58px;'), '行高固定 58px');
  assert(wxss.includes('.recent-title { font-size: 18px;'), '标题字号 15→18');
  assert(wxss.includes('.recent-name { font-size: 17px;'), '姓名字号 15→17（BX 大一号）');
});

// ---------- 5 Tab 图标（任务AB 第 4 项重绘：无外圈、颜色与亲友录/我的对齐，细节断言在 test-batch-ab） ----------
test('任务AA-Tab图标：162×162（重绘口径见任务AB）', () => {
  for (const n of ['home', 'home-active', 'wanglai', 'wanglai-active']) {
    const buf = fs.readFileSync(path.join(MP, 'images/tabbar', `${n}.png`));
    assert.eq(buf.readUInt32BE(16), 162, `${n}.png 宽 162`);
    assert.eq(buf.readUInt32BE(20), 162, `${n}.png 高 162`);
  }
});

// ---------- 6 开通会员页 ----------
test('任务AA-会员页：导出按钮删除、功能行标题不折行', () => {
  const wxml = readMp('pages/member/member-home.wxml');
  assert(!wxml.includes('一键导出账本') && !wxml.includes('btn-bottom') && !wxml.includes('height:100px'),
    '底部导出按钮与占位已删');
  const js = readMp('pages/member/member-home.js');
  assert(!js.includes('onExport'), 'onExport 已删');
  const wxss = readMp('pages/member/member-home.wxss');
  assert(wxss.includes('.form-label { width: 118px; white-space: nowrap; }'), '本页标题放宽不折行');
  assert(wxss.includes('text-overflow: ellipsis;'), '描述文字截断');
});

// ---------- 7 字体专项 ----------
test('任务AA-字体专项（AK批修订）：分包仅存霞鹜文楷为真 woff2、三款声明族名一致', () => {
  const dir = path.join(MP, 'packages/fonts');
  const expect = { 'lxgw-wenkai': 'LxgwWenKai', 'mashanzheng': 'MaShanZheng', 'longcang': 'LongCang' };
  for (const [file, family] of Object.entries(expect)) {
    assert.eq(LC.fontById({ 'lxgw-wenkai': 'lxgw', mashanzheng: 'mashanzheng', longcang: 'longcang' }[file]).family,
      family, `${file} 声明族名`);
  }
  // AK批瘦身后分包只剩霞鹜文楷一份实体文件，验它仍是真 woff2；另两款已删（云端 TTF 为正源）
  const buf = fs.readFileSync(path.join(dir, 'lxgw-wenkai.woff2'));
  assert.eq(buf.slice(0, 4).toString('ascii'), 'wOF2', 'lxgw-wenkai 是真 woff2');
  for (const gone of ['mashanzheng.woff2', 'longcang.woff2']) {
    assert(!fs.existsSync(path.join(dir, gone)), `${gone} 已按 AK 瘦身移除`);
  }
  const bookWxss = readMp('pages/landscape/book.wxss');
  assert(!bookWxss.includes('@font-face'), 'book.wxss 已无 @font-face（任务AC 第 8 项删除分包字体声明，族名对齐改由 font-manager loadFontFace 保证）');
});
