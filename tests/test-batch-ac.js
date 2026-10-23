/**
 * 任务AC（真机反馈第六批 9 项）测试：
 * 1 Tab 图标色调统一（#535353/#F45A5A 实测基准）＋往来改轮廓式放大；
 * 2 自定义 Tab 栏对齐原生（图标盒 30px、字号 13px、底距补偿 +6px）；
 * 3 送礼页顶部三行贴紧（页面级覆盖归零间距，全局 .card 不动）；
 * 4 日期行「›」右移（.form-val .chev margin-left 8px，五表单页同形态）；
 * 5 「+」只加大不加粗（46px、font-weight 300 不动）；
 * 6 亲友录加号下移（Tab 页 bottom 14px，屏幕位置与送礼/收礼一致）；
 * 7 往来页全部字号 +1（逐项断言）；
 * 8 字体候选改序 缓存→云→分包、book.wxss 无 @font-face、
 *    cloud-file 下载成功必持久化缓存；
 * 9 横置再收紧（COL_W 50、GAP 2、NAME_H 116、AMT_H 117、COL_INNER_H 290、不叠字扫验）。
 * 像素级证据（图标取色/边界框、横置墨迹间距）在任务AC 报告中以 PIL/CDP 量测给出。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const { createFontSource, CLOUD_FONT_BASE } = require('../miniprogram/services/font-source.js');

// ---------- 1 Tab 图标 ----------
test('任务AC-1图标：home/wanglai 细线轮廓风、色值对齐亲友录/我的实测主色', () => {
  const srcDir = path.join(__dirname, '..', 'docs', 'tab-icon-sources');
  for (const n of ['home-house', 'wanglai-people']) {
    const svg = fs.readFileSync(path.join(srcDir, `${n}.svg`), 'utf8');
    assert(svg.includes('stroke="#535353"'), `${n} 常态描边 #535353（亲友录/我的 PNG 实测主色）`);
    assert(svg.includes('stroke-width="32"'), `${n} 描边 32/512（与亲友录 5/81 同比例细线条）`);
    assert(svg.includes('fill="none"'), `${n} 轮廓式（fill none），不得实心`);
    const act = fs.readFileSync(path.join(srcDir, `${n}-active.svg`), 'utf8');
    assert(act.includes('stroke="#F45A5A"'), `${n} 选中描边 #F45A5A（亲友录/我的选中态实测主色）`);
  }
  const people = fs.readFileSync(path.join(srcDir, 'wanglai-people.svg'), 'utf8');
  assert((people.match(/<circle/g) || []).length === 2, '往来两个人头均为轮廓圆（旧版实心剪影已弃）');
  const house = fs.readFileSync(path.join(srcDir, 'home-house.svg'), 'utf8');
  assert(!/<rect[^>]*fill="#/.test(house), '房子门不得再实心填充');
  for (const n of ['home', 'wanglai', 'home-active', 'wanglai-active']) {
    const buf = fs.readFileSync(path.join(MP, 'images/tabbar', `${n}.png`));
    assert.eq(buf.readUInt32BE(16), 162, `${n}.png 宽 162`);
    assert.eq(buf.readUInt32BE(20), 162, `${n}.png 高 162`);
  }
});

// ---------- 2 自定义 Tab 栏对齐原生 ----------
test('任务AC-2Tab栏：图标盒 30px、字号 13px、栏高 50px、底距安全区+6px', () => {
  const wxss = readMp('components/tab-bar/tab-bar.wxss');
  assert(wxss.includes('.tabbar-icon { width: 30px; height: 30px; }'), '图标盒 30px（原生截图校准：图形=盒×2.4=72 物理px，与原生逐值一致）');
  assert(wxss.includes('.tabbar-text { font-size: 13px; line-height: 1.2; margin-top: 3px; }'), '字号 13px、字距 3px（字高 ≈ 原生 28 物理px）');
  assert(wxss.includes('height: 50px'), '栏内容高 50px 不变');
  assert(wxss.includes('padding-bottom: calc(env(safe-area-inset-bottom) + 6px)'), '底部内边距 = 安全区 + 6px（补偿与原生总高差）');
});

// ---------- 3 送礼页三行贴紧 ----------
test('任务AC-3送礼页：三行间距归零（页面级覆盖）、全局 .card 不动', () => {
  const g = readMp('pages/gifts/gifts.wxss');
  assert(g.includes('.searchbar { padding-bottom: 0; }'), '搜索行下内边距 10→0');
  assert(g.includes('.card.entry-row { margin-top: 0; margin-bottom: 0; }'), '横置礼单本入口行上下外边距 10→0');
  assert(g.includes('.card.summary { margin-top: 0; }'), '共计行上外边距 10→0');
  assert(readMp('app.wxss').includes('margin: 10px 12px;'), '全局 .card margin 保持 10px 12px（只动送礼页）');
});

// ---------- 4 日期旁 › 右移 ----------
test('任务AC-4日期箭头：.form-val .chev 左距 8px、五表单页日期行同形态命中', () => {
  assert(readMp('app.wxss').includes('.form-val .chev { margin-left: 8px; }'), '值容器内 › 的 margin-left 8px（原空格 ≈4px → 总 ≈12px）');
  for (const p of ['gift-add/gift-add', 'gift-edit/gift-edit', 'receive-add/receive-add',
    'receive-record-add/receive-record-add', 'receive-record-edit/receive-record-edit']) {
    const w = readMp(`pages/${p}.wxml`);
    assert(w.includes('<view class="form-val"><text class="num">{{date}}</text> <text class="chev">›</text></view>'),
      `${p} 日期行为 .form-val 内嵌 › 形态（被同一条规则命中）`);
  }
});

// ---------- 5 加号只加大不加粗 ----------
test('任务AC-5加号：.fab 字号 46px、font-weight 保持 300、三页无分叉覆盖', () => {
  const fab = (readMp('app.wxss').match(/\.fab \{[^}]*\}/) || [''])[0];
  assert(fab.includes('font-size: 46px'), '.fab「+」字号 40→46px');
  assert(fab.includes('font-weight: 300'), '.fab font-weight 保持 300（用户明确：只加大、不加粗）');
  for (const p of ['pages/gifts/gifts.wxss', 'pages/receive/receive.wxss']) {
    assert(!readMp(p).includes('.fab'), `${p} 不得有 .fab 覆盖（三页共用同一样式）`);
  }
  const c = readMp('pages/contacts/contacts.wxss');
  assert(!/\.fab \{[^}]*font-size/.test(c), '亲友录 .fab 覆盖只动 bottom、不动字号');
});

// ---------- 6 亲友录加号下移 ----------
test('任务AC-6加号位置：全局 bottom 64px 不动、亲友录页面级 14px（Tab 页补偿一栏高）', () => {
  const fab = (readMp('app.wxss').match(/\.fab \{[^}]*\}/) || [''])[0];
  assert(fab.includes('bottom: calc(64px + env(safe-area-inset-bottom))'), '全局 .fab bottom 仍 64px（送礼/收礼口径不动）');
  assert(readMp('pages/contacts/contacts.wxss').includes('.fab { bottom: 14px; }'),
    '亲友录 .fab bottom 14px：14+50（原生栏）=64，屏幕位置与送礼/收礼一致');
});

// ---------- 7 往来页字号 +1 ----------
test('任务AC-7往来字号：全页逐项 +1（姓名 17、金额 23、其余逐项断言）', () => {
  const w = readMp('pages/wanglai/wanglai.wxss');
  const expect = [
    ['.member-tip', '13px'], ['.tchip', '14px'], ['.date-box', '15px'], ['.daterange', '13px'],
    ['.side-label', '15px'], ['.side-amount', '23px'], ['.side-count', '13px'], ['.total-line', '14px'],
    ['.diff-label', '16px'], ['.diff-amount', '16px'],
  ];
  for (const [sel, size] of expect) {
    const block = (w.match(new RegExp(`\\${sel} \\{[^}]*\\}`)) || [''])[0];
    assert(block.includes(`font-size: ${size}`), `${sel} 字号应为 ${size}（+1 后）`);
  }
  assert((w.match(/\.wl-row \.nm \{[^}]*\}/) || [''])[0].includes('font-size: 17px'), '往来行姓名 16→17px');
  assert((w.match(/\.contact-row \.nm \{[^}]*\}/) || [''])[0].includes('font-size: 17px'), '联系人姓名 16→17px');
  assert((w.match(/\.wl-row \.count \{[^}]*\}/) || [''])[0].includes('font-size: 14px'), '笔数 13→14px');
  assert((w.match(/\.wl-row \.sep \{[^}]*\}/) || [''])[0].includes('font-size: 14px'), '分隔符 13→14px');
  assert((w.match(/\.wl-row \.diff \{[^}]*\}/) || [''])[0].includes('font-size: 16px'), '差额 15→16px');
  assert((w.match(/\.contact-row \.rmk \{[^}]*\}/) || [''])[0].includes('font-size: 14px'), '备注 13→14px');
  assert((w.match(/\.contact-row \.ph \{[^}]*\}/) || [''])[0].includes('font-size: 15px'), '电话占位 14→15px');
  assert((w.match(/\.empty-text \{[^}]*\}/) || [''])[0].includes('font-size: 15px'), '空态文字 14→15px');
});

// ---------- 8 字体改走云存储 ----------
test('任务AC-8字体候选序：缓存→云→分包；CLOUD_FONT_BASE 已填真实云存储前缀', () => {
  assert.eq(CLOUD_FONT_BASE, 'cloud://cloud1-d3gd7fjdx0d217df0.636c-cloud1-d3gd7fjdx0d217df0-1514234749/fonts/', 'CLOUD_FONT_BASE 为用户 2026-10-23 上传云存储 fonts/ 后的真实前缀');
  const defSrc = createFontSource({ storage: { get: () => '', set: () => {} }, fileExists: () => false });
  const defKinds = defSrc.resolveCandidates(LC.fontById('lxgw')).map((c) => c.kind);
  assert.eq(defKinds.join(','), 'cloud-file,subpackage', '默认（无缓存）候选：云文件第一、分包兜底');
  const st = { _m: new Map(), get(k) { return this._m.get(k) || ''; }, set(k, v) { this._m.set(k, v); } };
  st.set('landscape.fontCacheFile.lxgw', '/userData/landscape-fonts/lxgw-wenkai.woff2');
  const src = createFontSource({ storage: st, fileExists: () => true, cloudBase: 'cloud://env-x.bucket-y/fonts/' });
  const kinds = src.resolveCandidates(LC.fontById('lxgw')).map((c) => c.kind);
  assert.eq(kinds.join(','), 'cache,cloud-file,subpackage', '候选顺序：缓存 → 云文件 → 分包兜底');
});

test('任务AC-8字体：book.wxss 无 @font-face；cloud-file 下载成功必持久化到用户数据区缓存', async () => {
  assert(!readMp('pages/landscape/book.wxss').includes('@font-face'), 'book.wxss 三条分包 @font-face 已删（Android 死代码）');
  const st = { _m: new Map(), get(k) { return this._m.get(k) || ''; }, set(k, v) { this._m.set(k, v); } };
  let savedTo = null;
  const wxApi = {
    env: { USER_DATA_PATH: '/userData' },
    cloud: { downloadFile: (o) => o.success({ tempFilePath: '/tmp/font-tmp.woff2' }) },
    getFileSystemManager: () => ({
      mkdirSync: () => {},
      saveFileSync: (from, to) => { savedTo = to; },
      accessSync: () => {},
    }),
    getStorageSync: () => '', setStorageSync: () => {},
  };
  const src = createFontSource({ wxApi, storage: st, cloudBase: 'cloud://env-x.bucket-y/fonts/' });
  const cand = src.resolveCandidates(LC.fontById('lxgw')).find((c) => c.kind === 'cloud-file');
  const source = await src.materialize(cand, LC.fontById('lxgw'));
  assert.eq(source, 'url("/tmp/font-tmp.woff2")', 'materialize 返回临时路径来源串');
  assert.eq(savedTo, '/userData/landscape-fonts/lxgw-wenkai.woff2', '下载成功后持久化到用户数据区缓存目录');
  assert.eq(st._m.get('landscape.fontCacheFile.lxgw'), '/userData/landscape-fonts/lxgw-wenkai.woff2', 'storage 记缓存路径（下次走缓存直读、断网可用）');
});

// ---------- 9 横置再收紧 ----------
test('任务AC-9横置：COL_W 50/GAP 2/NAME_H 116/AMT_H 117/总高 290、三字体全长不叠字扫验', () => {
  assert.eq(LC.SPEC.COL_W, 50, '列宽 56→50');
  assert.eq(LC.SPEC.GAP, 2, '墨迹间距目标 5→2');
  assert.eq(LC.SPEC.NAME_H, 116, '姓名区（按真实列高几何反推）');
  assert.eq(LC.SPEC.AMT_H, 117, '金额区（按真实列高几何反推）');
  assert.eq(LC.COL_INNER_H, 290, '列内总高 = 纸面高 294 − 边框 4');
  // 不叠字：字距 − 校准后字号 ≥ −0.01（round2 尘埃内视为相接不重叠，与旧版式同口径）
  for (const fid of ['lxgw', 'mashanzheng', 'longcang']) {
    const cal = LC.fontById(fid).calibration;
    for (let n = 2; n <= 7; n++) {
      const nm = LC.layoutName('欧'.repeat(n), cal);
      assert(nm.pitch - nm.fontSize * cal >= -0.01, `${fid} ${n} 字名不叠字（字距 ${nm.pitch} vs 实际字号 ${(nm.fontSize * cal).toFixed(2)}）`);
      const am = LC.layoutAmount(10 ** (n + 1) * 100, cal);
      assert(am.pitch - am.fontSize * cal >= -0.01, `${fid} 金额「${am.text}」不叠字`);
    }
  }
  assert(fs.existsSync(path.join(__dirname, '..', 'docs/screens/landscape-fix-check/model.png')), '量测图 model.png 已按新 SPEC 重渲（像素量测见任务AC 报告）');
});
