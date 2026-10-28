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
 *    字体经云存储换临时 https 链接加载（任务AE）；
 * 9 横置再收紧（COL_W 50、GAP 2、NAME_H 116、AMT_H 117、COL_INNER_H 290、不叠字扫验；任务AE 后 GAP 3.5/NAME_H 114.5/AMT_H 115.5，断言已同步）。
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
  assert(g.includes('.searchbar { padding-bottom: 0; position: sticky; top: 0; z-index: 10; background: #F6F6F6; }'), '搜索行下内边距 10→0（BX 加冻结 sticky，仍是页面级覆盖）');
  assert(g.includes('.card.entry-row { margin-top: 0; margin-bottom: 0; }'), '横置礼单本入口行上下外边距 10→0');
  assert(g.includes('.card.list-card { margin-top: 0; overflow: hidden; }'), '共计与记录合并卡上外边距 10→0（BX 加裁溢出，仍是页面级覆盖）');
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
test('任务AC-7往来字号：全页逐项 +1（姓名 18（BX 再大一号）、金额 23、其余逐项断言）', () => {
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
  assert((w.match(/\.wl-row \.nm \{[^}]*\}/) || [''])[0].includes('font-size: 18px'), '往来行姓名 17→18px（BX 大一号）');
  assert((w.match(/\.contact-row \.nm \{[^}]*\}/) || [''])[0].includes('font-size: 18px'), '联系人姓名 17→18px（BX 大一号）');
  assert((w.match(/\.wl-row \.count \{[^}]*\}/) || [''])[0].includes('font-size: 14px'), '笔数 13→14px');
  assert((w.match(/\.wl-row \.sep \{[^}]*\}/) || [''])[0].includes('font-size: 14px'), '分隔符 13→14px');
  assert((w.match(/\.wl-row \.diff \{[^}]*\}/) || [''])[0].includes('font-size: 16px'), '差额 15→16px');
  assert((w.match(/\.contact-row \.rmk \{[^}]*\}/) || [''])[0].includes('font-size: 14px'), '备注 13→14px');
  assert((w.match(/\.contact-row \.ph \{[^}]*\}/) || [''])[0].includes('font-size: 15px'), '电话占位 14→15px');
  assert((w.match(/\.empty-text \{[^}]*\}/) || [''])[0].includes('font-size: 15px'), '空态文字 14→15px');
});

// ---------- 8 字体来源（任务AE 改走临时 https 链接；AC 的本地下载路线已被真机证伪） ----------
test('任务AE-8字体候选序：云链接→分包；CLOUD_FONT_BASE 已填真实云存储前缀', () => {
  assert.eq(CLOUD_FONT_BASE, 'cloud://cloud1-d3gd7fjdx0d217df0.636c-cloud1-d3gd7fjdx0d217df0-1514234749/fonts/', 'CLOUD_FONT_BASE 为用户 2026-10-23 上传云存储 fonts/ 后的真实前缀');
  const defSrc = createFontSource({ storage: { get: () => '', set: () => {} } });
  const defCands = defSrc.resolveCandidates(LC.fontById('lxgw'));
  assert.eq(defCands.map((c) => c.kind).join(','), 'cloud-api,cloud-data,cloud-url,cloud-url,subpackage', '候选：服务端代取（TTF）→直下载 Data URL→临时链接 TTF→woff2→分包兜底（2026-10-25 AH批 v7 路线）');
  assert.eq(defCands[0].needsApiData, true, '第一候选走服务端代取（AH批 v7）');
  assert(defCands[0].fileID.endsWith('/fonts/lxgw-wenkai.ttf'), '第一候选 fileID 指向云存储 TTF');
  assert.eq(defCands[1].needsDataUrl, true, '第二候选走直下载转 Data URL（v6 路线保留）');
  assert.eq(defCands[2].needsTempUrl, true, '临时链接候选须先换链');
  assert(defCands[2].fileID.endsWith('/fonts/lxgw-wenkai.ttf'), '第三候选 fileID 指向云存储 TTF');
  assert(defCands[3].fileID.endsWith('/fonts/lxgw-wenkai.woff2'), '第四候选 fileID 指向云存储 woff2');
});

test('任务AE-8字体：book.wxss 无 @font-face；materialize 经 getTempFileURL 换 https 链接（不落本地文件）', async () => {
  assert(!readMp('pages/landscape/book.wxss').includes('@font-face'), 'book.wxss 三条分包 @font-face 已删（Android 死代码）');
  const st = { _m: new Map(), get(k) { return this._m.get(k) || ''; }, set(k, v) { this._m.set(k, v); } };
  let askedFor = null;
  const wxApi = {
    cloud: {
      getTempFileURL: (o) => {
        askedFor = o.fileList[0];
        o.success({ fileList: [{ fileID: o.fileList[0], tempFileURL: 'https://tmp.example.com/lxgw.woff2', status: 0 }] });
      },
    },
    getStorageSync: () => '', setStorageSync: () => {},
  };
  const src = createFontSource({ wxApi, storage: st, cloudBase: 'cloud://env-x.bucket-y/fonts/' });
  const cand = src.resolveCandidates(LC.fontById('lxgw')).find((c) => c.needsTempUrl);
  const source = await src.materialize(cand, LC.fontById('lxgw'));
  assert.eq(askedFor, 'cloud://env-x.bucket-y/fonts/lxgw-wenkai.ttf', '换链入参为 TTF 的 fileID（第一候选）');
  assert.eq(source, 'url("https://tmp.example.com/lxgw.woff2")', 'materialize 返回临时 https 来源串（loadFontFace 官方支持的网络形态）');
  assert.eq(st._m.get('landscape.fontCacheFile.lxgw'), undefined, '不再写本地文件缓存路径（本地路线已废除）');
});

// ---------- 9 横置再收紧 ----------
test('任务AC-9横置（任务AF 更新 GAP/区高；2026-10-25 姓名区再收）：COL_W 50/GAP 4/NAME_H 104/AMT_H 118.5/总高 290、三字体全长不叠字扫验', () => {
  assert.eq(LC.SPEC.COL_W, 50, '列宽 56→50');
  assert.eq(LC.SPEC.GAP, 4, '墨迹间距目标（5→2 任务AC → 3.5 任务AE → 4 任务AF）');
  assert.eq(LC.SPEC.NAME_H, 104, '姓名区（AC 116 → AE 114.5 → AF 114.5 → 2026-10-25 上下往中间收 104）');
  assert.eq(LC.SPEC.AMT_H, 118.5, '金额区（AC 反推 117，AE 为 GAP 3.5 收 1.5，本轮中段上移后反增至 118.5）');
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

// ---------- 任务AE 第 8 项：共计与列表复刻定版图（三页同构） ----------
test('任务AE-8共计列表复刻：居中大字分段红字、合并一卡、细线分隔、日期一行、行高一致、末尾「完」', () => {
  for (const [wxmlP, wxssP, rowCls] of [
    ['pages/gifts/gifts.wxml', 'pages/gifts/gifts.wxss', 'gift-row'],
    ['pages/receive-detail/receive-detail.wxml', 'pages/receive-detail/receive-detail.wxss', 'rec-row'],
    ['pages/example/gift-example.wxml', 'pages/example/gift-example.wxss', 'gift-row'],
  ]) {
    const w = readMp(wxmlP);
    const x = readMp(wxssP);
    if (wxmlP.includes('receive-detail')) {
      // 2026-10-24 用户改定：头部与共计/记录上下合成一块（同一张 pat-card、共计接在日期下面、无灰色间隔）
      assert(w.includes('card pat-card') && !w.includes('card list-card'), `${wxmlP}：头部与共计/记录应合成一张卡`);
      assert(w.indexOf('event-date') < w.indexOf('total-line'), `${wxmlP}：共计应直接接在日期下面`);
    } else {
      assert(w.includes('card list-card'), `${wxmlP}：共计与记录应合并为一张卡`);
    }
    assert(w.includes('<text class="red num">{{totalCount}}</text><text>笔 ¥</text><text class="red num">{{totalAmountText}}</text>'), `${wxmlP}：共计分段——笔数与金额数字红字、笔/¥/元深色`);
    assert(w.includes('class="subline"'), `${wxmlP}：场合/类型与日期应在同一行（subline）`);
    assert(w.includes('<text class="end-text">完</text>'), `${wxmlP}：列表末尾应有「完」`);
    assert(x.includes('.total-line { text-align: center; font-size: 20px;'), `${wxssP}：共计居中 20px 大字`);
    assert(x.includes('height: 64px'), `${wxssP}：记录行固定高 64px（三页一致，2026-10-24 用户改定，原 76px）`);
    assert(x.includes(`.${rowCls}::after`), `${wxssP}：行间为内嵌细线（::after），无卡片灰底间隔`);
    assert(x.includes('.list-end { display: flex; align-items: center; gap: 10px; padding: 17px 60px 19px; }'), `${wxssP}：「完」就嵌在最后一条下方的横线上（无额外横线），上下间距比行间略宽（用户 2026-10-24 真机反馈定版）`);
    assert(!x.includes('.summary'), `${wxssP}：旧 .summary 已清除`);
  }
  const g = readMp('pages/gifts/gifts.wxss');
  assert(g.includes('background: #F1E6D3') && g.includes('width: 44px; height: 44px'), '送礼徽章：44px 米色圆底（2026-10-25 用户亲改：与收礼礼簿页图标一致，覆盖定版图 56px 口径）');
  assert(g.includes('left: 84px'), '送礼分隔线从姓名左缘起（16+56+12）');
  const rd = readMp('pages/receive-detail/receive-detail.wxss');
  assert(rd.includes('left: 16px'), '收礼记录无徽章，分隔线自左内边距起');
});

test('AC字体诊断：云端找不到文件时原因要留得住（2026-10-24 真机字体定位）', async () => {
  const { createFontSource } = require('../miniprogram/services/font-source.js');
  const { createFontManager } = require('../miniprogram/services/font-manager.js');
  const st = { get: () => '', set: () => {} };
  const wxApi = {
    cloud: {
      getTempFileURL: ({ success }) => success({
        fileList: [{ status: -503003, errMsg: 'STORAGE_FILE_NONEXIST', tempFileURL: '' }],
      }),
    },
    loadFontFace: ({ fail }) => fail && fail(new Error('loadFontFace:fail')),
    loadSubpackage: ({ fail }) => fail && fail(new Error('no subpackage')),
  };
  const src = createFontSource({ wxApi, storage: st, cloudBase: 'cloud://env-x.bucket-y/fonts/' });
  const font = { id: 'lxgw', file: 'lxgw-wenkai.woff2', family: 'LxgwWenKai' };
  const cand = src.resolveCandidates(font).find((c) => c.needsTempUrl);
  const out = await src.materialize(cand, font);
  assert.eq(out, null, '文件不存在时物化应失败');
  const me = src.getLastMaterializeError();
  assert(me && /NONEXIST/.test(me.reason), `失败原因应保留云端原文（实际 ${me && me.reason}）`);
  const mgr = createFontManager({ wxApi, storage: st, cloudBase: 'cloud://env-x.bucket-y/fonts/' });
  const ok = await mgr.load('lxgw');
  assert.eq(ok, false, '加载应失败');
  const f = mgr.getLastFailure('lxgw');
  assert(f && f.stage === 'data-url', '管理器应记录首选路线 data-url 阶段（该 stub 无 downloadFile/读文件接口，下载转码先失败；临时链接的 NONEXIST 已由上方 materialize 断言单独覆盖）');
});
