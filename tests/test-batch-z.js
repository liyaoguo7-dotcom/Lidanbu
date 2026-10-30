/**
 * 任务Z（真机反馈第三批）源码/行为断言：
 * 1 自定义 Tab 栏进送礼/收礼页；2 加号三页统一 64px/字号 40；3 Tab 文字加深；
 * 4 购买页方块化 + 积分三档落配置；5 邀请去码化（inviter 参数）；
 * 6 样式按钮加大加红左移下移；7 字体加载（@font-face 已被任务AC 第 8 项删除）+ loadFontFace global + 回页重试；
 * 8 金额底锚定/中段居中/金额字号 22；9 修改亲友面板 60vh；10 礼薄名去宋体；
 * 11/12 详情页目标图版式；13 清单 7 页标签改淡；14 导出页 openDocument 预览。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');

// ---------- 第 1 项：自定义 Tab 栏 ----------
test('任务Z-1：tab-bar 组件四件套齐全、switchTab 跳四 Tab、两页已接入且不高亮', () => {
  for (const ext of ['js', 'wxml', 'wxss', 'json']) {
    assert(fs.existsSync(path.join(MP, `components/tab-bar/tab-bar.${ext}`)), `tab-bar.${ext} 存在`);
  }
  const js = readMp('components/tab-bar/tab-bar.js');
  assert(js.includes('wx.switchTab'), '点击走 switchTab');
  for (const p of ['/pages/index/index', '/pages/wanglai/wanglai', '/pages/contacts/contacts', '/pages/mine/mine']) {
    assert(js.includes(p), `包含 Tab 路径 ${p}`);
  }
  assert(readMp('components/tab-bar/tab-bar.wxss').includes('env(safe-area-inset-bottom)'), '含安全区');
  for (const pg of ['gifts/gifts', 'receive/receive']) {
    const j = JSON.parse(readMp(`pages/${pg}.json`));
    assert(j.usingComponents && j.usingComponents['tab-bar'], `${pg}.json 注册 tab-bar`);
    const w = readMp(`pages/${pg}.wxml`);
    assert(w.includes('<tab-bar'), `${pg} 挂了 tab-bar`);
    assert(w.includes('tabbar-spacer'), `${pg} 有底部占位防遮挡`);
    assert(w.includes('class="fab"') && !w.includes('fab fab-low'), `${pg} 加号用带栏高度 .fab`);
  }
});

// ---------- 第 2/3 项：加号与 Tab 文字 ----------
test('任务Z-2/3：.fab 字号（AC 第 5 项改 46px）；tabBar 未选文字 #404040、选中红不变', () => {
  const wxss = readMp('app.wxss');
  const fab = (wxss.match(/\.fab \{[^}]*\}/) || [''])[0];
  assert(fab.includes('font-size: 46px'), '.fab 字号 46px（Z 定 40，任务AC 第 5 项只加大不加粗再 +6）');
  const app = JSON.parse(readMp('app.json'));
  assert.eq(app.tabBar.color, '#404040', 'tabBar 未选文字加深');
  assert.eq(app.tabBar.selectedColor, '#F0575A', '选中红不变');
});

// ---------- 第 4 项：购买页 ----------
test('任务Z-4：积分礼包三档落配置（金额高风险，逐值断言）', () => {
  const cfg = require('../miniprogram/config/app-config');
  const packs = cfg.points.packs;
  assert.eq(packs.length, 3, '三档');
  assert.eq(packs.map((p) => `${p.priceFen}/${p.points}`).join(','), '100/10,300/30,500/50', '三档价格（分）/积分逐值');
  assert.eq(cfg.pricing.length, 4, '会员四档不变');
});

test('任务Z-4：购买页方块网格、选中态、推荐角标不压金额、金棕区分', () => {
  const wxml = readMp('pages/member/purchase/purchase.wxml');
  assert(wxml.includes('block-grid') && wxml.includes('plan-block') && wxml.includes('pack-block'), '套餐/礼包都是方块网格');
  assert(wxml.includes('selectedPlanId') && wxml.includes('selectedPackId'), '有选中态绑定');
  assert(!wxml.includes('plan-card'), '旧长条卡已删除');
  const badgeIdx = wxml.indexOf('badge-hot');
  const priceIdx = wxml.indexOf('plan-price');
  assert(badgeIdx > -1 && priceIdx > badgeIdx, '推荐角标在价格之前（块顶），不与金额同行叠压');
  const wxss = readMp('pages/member/purchase/purchase.wxss');
  assert(wxss.includes('.plan-block.sel') && wxss.includes('.pack-block.sel'), '两种方块都有选中态');
  assert(wxss.includes('#B8860B'), '积分方块用金棕系');
  assert(wxss.indexOf('.badge-hot') > -1 && wxss.includes('top: -9px'), '角标挂在方块顶边外侧');
  const js = readMp('pages/member/purchase/purchase.js');
  assert(js.includes('onSelectPlan') && js.includes('onSelectPack'), '点按选中处理函数齐全');
  assert(js.includes('purchaseMembership') && js.includes('purchasePointsPack'), '下单仍走原 data-service 接口');
});

// ---------- 第 5 项：邀请去码化 ----------
test('任务Z-5：邀请页无可见邀请码/无填码入口，分享走 inviter 参数与预置标题', () => {
  const wxml = readMp('pages/invite/invite-reward.wxml');
  assert(!wxml.includes('我的邀请码'), '不展示邀请码');
  assert(!wxml.includes('填写邀请码') && !wxml.includes('<input'), '没有填码入口');
  assert(!wxml.includes('onCopyCode') && !wxml.includes('复制'), '没有复制邀请码');
  assert(wxml.includes('open-type="share"'), '发给好友按钮调起微信发送面板');
  const js = readMp('pages/invite/invite-reward.js');
  assert(!js.includes('onBindSubmit') && !js.includes('setClipboardData'), '填码提交/复制逻辑已删');
  assert(js.includes('礼单簿：人情往来，一笔笔记清'), '分享标题逐字');
  assert(js.includes('/pages/index/index?inviter='), '分享路径带 inviter 参数');
  const app = readMp('app.js');
  assert(app.includes('q.inviter'), 'app.js 捕获 inviter 参数');
  assert(!app.includes('inviteCode'), 'app.js 不再读 inviteCode 参数');
  const shareInvite = readMp('pages/share/share-invite.wxml');
  assert(!shareInvite.includes('邀请码：'), '家庭共享邀请页不展示邀请码文字');
  assert(!readMp('pages/mine/faq.js').includes('邀请码'), 'FAQ 不再提邀请码');
});

// ---------- 第 6 项：样式按钮 ----------
test('任务Z-6（BV修订：红字已由用户 2026-10-28 改定去掉）：样式按钮 17px、不下移、左移再加 10px、底色字色跟主题', () => {
  const wxss = readMp('pages/landscape/book.wxss');
  const btn = (wxss.match(/\.style-btn \{[^}]*\}/) || [''])[0];
  assert(btn.includes('font-size: 17px'), '字号 13→17px');
  assert(!btn.includes('#F0575A'), '红字已去掉（BV 用户定）');
  assert(btn.includes('translateY(0px)') && !btn.includes('translateY(6px)'), '不得再下移 6px（顶栏居中，与纸面留空隙）');
  const common = readMp('pages/landscape/book-common.js');
  assert(common.includes('+ 22'), '胶囊避让偏移 12→22（再左移 10px）');
  assert(common.includes('styleRightPx: 120'), '兜底偏移 110→120');
  const wxml = readMp('pages/landscape/book.wxml');
  assert(wxml.includes('{{theme.styleBtnBg}}') && wxml.includes('{{theme.inkColor}}'), '底色字色跟主题');
});

// ---------- 第 7 项：字体切换修复 ----------
test('任务Z-7（AK 第 8 项再修订）：book.wxss 已无 @font-face、分包只保留霞鹜文楷兜底', () => {
  const wxss = readMp('pages/landscape/book.wxss');
  const LC = require('../miniprogram/pages/landscape/landscape-core.js');
  assert(!wxss.includes('@font-face'), 'book.wxss 不得再有 @font-face（Android 加载不了分包字体，官方 Known BUG；任务AC 第 8 项删除）');
  // AK批瘦身（2026-10-25）：马善政/龙藏 woff2 超 200K 且分包路线 Android 已知死路、
  // 云端代取已真机验通——两文件已删；霞鹜文楷（167K 未超限）保留分包兜底。
  assert(fs.existsSync(path.join(MP, 'packages/fonts', 'lxgw-wenkai.woff2')), '霞鹜文楷分包文件保留');
  for (const gone of ['mashanzheng.woff2', 'longcang.woff2']) {
    assert(!fs.existsSync(path.join(MP, 'packages/fonts', gone)), `${gone} 已按 AK 瘦身移除`);
  }
  const fm = readMp('services/font-manager.js');
  assert(fm.includes('global: true'), 'loadFontFace 带 global:true（增强路径保留）');
  const common = readMp('pages/landscape/book-common.js');
  assert(common.includes('okFont'), 'onShow 对加载失败的字体回页重试');
});

test('任务Z-7：loadFontFace 行为——global 透传、成功后状态 loaded', async () => {
  const { createFontSource } = require('../miniprogram/services/font-source.js');
  const { createFontManager } = require('../miniprogram/services/font-manager.js');
  const store = new Map();
  const storage = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  let captured = null;
  const wxApi = {
    loadSubpackage: (o) => o.success(),
    loadFontFace: (o) => { captured = o; o.success(); },
  };
  const fontSource = createFontSource({ storage, wxApi, fileExists: () => false });
  const fm = createFontManager({ wxApi, storage, fontSource });
  const ok = await fm.load('lxgw');
  assert.eq(ok, true, '加载成功');
  assert(captured && captured.global === true, 'loadFontFace 参数带 global:true');
  assert.eq(captured.family, 'LxgwWenKai', 'family 名与 FONTS 表一致');
  assert.eq(fm.getState('lxgw'), 'loaded', '状态置 loaded');
});

// ---------- 第 8 项：横置列内布局（任务AA 修订：金额字形盒底锚） ----------
test('任务Z-8：金额底锚定（末字字形盒贴区底）、字号与姓名一致、中段区内居中', () => {
  const LC = require('../miniprogram/pages/landscape/landscape-core.js');
  assert.eq(LC.SPEC.AMT_FONT, 22, '金额字号 22');
  assert.eq(LC.SPEC.AMT_FONT, LC.SPEC.NAME_FONT, '金额与姓名字号一致');
  assert.eq(LC.SPEC.AMT_H, 118.5, '金额区高 118.5（任务AF 模型实测校准；历程 117→115.5→118.5；旧 96 口径已废）');
  for (const fen of [100, 1000, 10000, 100000, 123456]) {
    const a = LC.layoutAmount(fen);
    const last = a.chars[a.chars.length - 1];
    // 任务AA 口径：末字字形盒下缘 = 区高（旧口径 top+pitch 多出 pitch−fontSize 的空档，已废）
    assert(Math.abs(last.top + a.fontSize - LC.SPEC.AMT_H) < 0.011,
      `${fen}分 末字「整」字形盒应贴区底（top=${last.top}, fontSize=${a.fontSize}）`);
  }
  const a3 = LC.layoutAmount(100); // 壹元整 3 字
  assert.eq(a3.text, '壹元整', '3 字金额文本');
  assert.eq(a3.chars[0].top, 0, '3 字金额首字在区顶（2026-10-22 晚均布制：首字上移到贺礼下 5px）');
  const built = LC.buildColumns([{ id: 'r1', name: '张三', amountFen: 10000, tagId: 'jiehun' }], { fontId: 'lxgw' });
  const mid = built.columns[0].midChars;
  assert.eq(mid.length, 2, '中段两字（贺礼）');
  const topPad = mid[0].top;
  const botPad = LC.SPEC.MID_H - (mid[mid.length - 1].top + LC.SPEC.MID_FONT);
  assert(Math.abs(topPad - botPad) < 0.011, `中段上下留白一致（上${topPad}/下${botPad}）`);
  // 姓名维持顶锚定：2 字名仍占第 1、3 字位
  const n2 = LC.layoutName('欧阳');
  assert.eq(n2.chars[0].top, 0, '姓名顶锚定不变');
});

// ---------- 第 11/12 项：详情页目标图版式 ----------
test('任务Z-11：送礼详情按目标图（红圆徽章/特大金额/操作行/往来链）', () => {
  const wxml = readMp('pages/gift-detail/gift-detail.wxml');
  for (const s of ['dt-badge', 'dt-amount', 'dt-actions', 'dt-vline', 'trash.svg', 'pen.svg']) {
    assert(wxml.includes(s), `应含 ${s}`);
  }
  assert(wxml.includes('{{amountText}}'), '金额走既有 amountText（formatAmount 两位小数+负号）');
  assert(wxml.includes('查看往来记录＞＞'), '卡下红色往来链');
  assert(!wxml.includes('bottom-btns') && !wxml.includes('pat-card'), '旧底部按钮条/旧图案卡已删');
  const wxss = readMp('pages/gift-detail/gift-detail.wxss');
  assert(wxss.includes('.dt-label') && wxss.includes('color: #999999'), '左标签浅灰');
  assert(wxss.includes('.dt-val') && wxss.includes('color: #333333'), '右内容深色');
  assert(wxss.includes('font-size: 44px'), '金额特大');
});

test('任务Z-12：收礼详情按目标图（红包徽章+事件名/正号金额/含类型行）', () => {
  const wxml = readMp('pages/receive-record-detail/receive-record-detail.wxml');
  for (const s of ['dt-badge', 'hongbao.svg', '{{eventName}}', 'dt-amount', 'dt-actions', 'trash.svg', 'pen.svg']) {
    assert(wxml.includes(s), `应含 ${s}`);
  }
  assert(wxml.includes('+{{amountText}}'), '金额带正号');
  assert(wxml.includes('>类型</text>'), '类型字段同列保留');
  assert(!wxml.includes('bottom-btns'), '旧底部按钮条已删');
  const js = readMp('pages/receive-record-detail/receive-record-detail.js');
  assert(js.includes('getRecordDetail') && js.includes('d.event'), 'JS 经详情聚合取礼薄（事件）名与白事标记（2026-10-24 提速：一趟取齐）');
  const wxss = readMp('pages/receive-record-detail/receive-record-detail.wxss');
  assert(wxss.includes('color: #999999') && wxss.includes('color: #333333'), '标签淡/内容深');
});

// ---------- 第 13 项：清单内 5 个表单页（另 2 个详情页已在 11/12 断言） ----------
test('任务Z-13：清单内表单页逐页标签改淡（本页覆盖），全局类未动', () => {
  for (const p of ['gift-add', 'gift-edit', 'receive-record-add', 'receive-record-edit', 'receive-add']) {
    const wxss = readMp(`pages/${p}/${p}.wxss`);
    assert(wxss.includes('.form-label { color: #999999; }'), `${p} 本页标签应为 #999999`);
  }
  const global = (readMp('app.wxss').match(/\.form-label \{[^}]*\}/) || [''])[0];
  assert(!global.includes('color'), '全局 .form-label 不带颜色（清单外页面不受影响）');
  // 清单外抽查：购买页（清单外）不得出现本页标签改淡覆盖
  assert(!readMp('pages/member/purchase/purchase.wxss').includes('.form-label { color: #999999'), '清单外页面未被改动');
});

// ---------- 第 14 项：导出页交付方式 ----------
test('任务Z-14：导出页生成后 openDocument 预览，不再直接发送文件', () => {
  const js = readMp('pages/export/export-home.js');
  assert(js.includes('wx.openDocument'), '走 openDocument 预览');
  assert(js.includes("fileType: 'xlsx'"), 'fileType 为 xlsx');
  assert(js.includes('showMenu: true'), 'showMenu 打开（转发/保存走文档菜单）');
  assert(!/wx\.shareFileMessage\s*\(/.test(js), '不得再调文件发送接口');
  const wxml = readMp('pages/export/export-home.wxml');
  assert(wxml.includes('导出并预览'), '按钮文案改版');
  assert(!wxml.includes('导出并发送至微信'), '旧按钮文案删除');
  assert(wxml.includes('onEventToggle') && wxml.includes('onGiftsToggle'), '范围勾选保留（礼薄多选+送礼）');
});
