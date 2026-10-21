/**
 * 横置礼单本测试（阶段4 任务A）
 * 覆盖高风险项：样式/字体互不重置、白事无红、字体分工、字体加载失败回退、
 * 会员到期保留选择、成员权限隐藏按钮、转屏关半屏、金额一致性、空列格子、缩放界内。
 */
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');
const { createFontManager } = require('../miniprogram/services/font-manager.js');
const { amountToChineseUpper } = require('../core/format');

function memStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : ''), set: (k, v) => m.set(k, v), _map: m };
}

test('横置-定版数值：列宽64.5/三段78+10+52+10+96/列内总高258', () => {
  assert.eq(LC.SPEC.COL_W, 64.5, '列宽');
  assert.eq(LC.SPEC.NAME_H, 78, '姓名区');
  assert.eq(LC.SPEC.MID_H, 52, '中段区');
  assert.eq(LC.SPEC.AMT_H, 96, '金额区');
  assert.eq(LC.COL_INNER_H, 258, '列内总高 6+78+10+52+10+96+6');
  assert.eq(LC.SPEC.COLS_PER_SCREEN, 12, '一屏12列');
});

test('横置-样式与字体互不重置：改样式后字体字段不变', () => {
  const st = memStorage();
  const store = LC.createSelectionStore(st);
  store.setFont('longcang');
  store.setStyle('bamboo');
  assert.eq(store.getFont(), 'longcang', '改样式后字体仍为龙藏体');
  assert.eq(st._map.get(LC.createSelectionStore(st).keys.font), 'longcang', '字体字段独立存储');
});

test('横置-样式与字体互不重置：改字体后样式字段不变', () => {
  const st = memStorage();
  const store = LC.createSelectionStore(st);
  store.setStyle('pear');
  store.setFont('mashanzheng');
  assert.eq(store.getStyle(), 'pear', '改字体后样式仍为梨花白');
  assert.eq(store.getFont(), 'mashanzheng', '字体已更新');
});

test('横置-会员到期后选择仍保存：新实例读回字体与样式', () => {
  const st = memStorage();
  const s1 = LC.createSelectionStore(st);
  s1.setFont('longcang');
  s1.setStyle('cloud');
  // 会员状态不在存储层：到期/续费都不经手选择，重新进入读回原值（只存不用、续费恢复）
  const s2 = LC.createSelectionStore(st);
  assert.eq(s2.getPrefs().fontId, 'longcang', '字体选择保留');
  assert.eq(s2.getPrefs().styleId, 'cloud', '样式选择保留');
});

test('横置-白事样式无红色：主题常量（＋/高亮/中段/列线）全为黑灰系', () => {
  const t = LC.themeById('funeral');
  assert.eq(t.noRed, true, 'funeral.noRed');
  const isReddish = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return r > 120 && r - g > 40 && r - b > 40;
  };
  for (const k of ['plusBg', 'highlightBorder', 'midColor', 'lineColor', 'frameColor']) {
    assert(!isReddish(t[k]), `白事 ${k}=${t[k]} 不得为红色`);
  }
  // 任何字体下白事中段（奠仪）恒宋体、主题判定不随字体变
  for (const f of LC.FONTS) {
    const built = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: 'baishi' }], { fontId: f.id });
    const col = built.columns[built.columns.length - 1];
    assert.eq(col.midRole, 'songti', `${f.id} 下奠仪恒宋体`);
  }
  assert.eq(LC.resolveReceiveTheme('baishi', 'classic'), 'funeral', '白事礼薄强制白事样式');
});

test('横置-字体分工：礼金随所选字体，贺礼/奠仪恒宋体', () => {
  assert.eq(LC.fontRoleForMid('礼金'), 'selected', '礼金跟随所选字体');
  assert.eq(LC.fontRoleForMid('贺礼'), 'songti', '贺礼恒宋体');
  assert.eq(LC.fontRoleForMid('奠仪'), 'songti', '奠仪恒宋体');
  const g = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: 'yasui' }], {});
  assert.eq(g.columns[g.columns.length - 1].midText, '礼金', '压岁标签→礼金');
  assert.eq(g.columns[g.columns.length - 1].midRole, 'selected', '礼金列 role=selected');
  const h = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: 'jiehun' }], {});
  assert.eq(h.columns[h.columns.length - 1].midRole, 'songti', '贺礼列 role=songti');
});

test('横置-字体回退链：所选字体→楷体→宋体，缺字不出方框', () => {
  for (const f of LC.FONTS) {
    const stack = LC.selectedStack(f.id);
    assert(stack.includes(f.family), `${f.id} 栈首为所选字体`);
    assert(stack.includes('KaiTi'), `${f.id} 栈含楷体回退`);
    assert(stack.includes('Songti SC'), `${f.id} 栈含宋体回退`);
  }
  // 校准系数定版值
  assert.eq(LC.fontById('lxgw').calibration, 1.00, '文楷系数');
  assert.eq(LC.fontById('mashanzheng').calibration, 1.05, '马善政系数');
  assert.eq(LC.fontById('longcang').calibration, 1.20, '龙藏系数');
});

test('横置-字体加载失败：回退标记、不抛错、成功后写缓存标记', async () => {
  const st = memStorage();
  const failWx = { loadFontFace: (o) => o.fail(new Error('offline')) };
  const fm = createFontManager({ wxApi: failWx, storage: st });
  const ok = await fm.load('lxgw'); // 不得 reject
  assert.eq(ok, false, '离线加载返回 false');
  assert.eq(fm.getState('lxgw'), 'failed', '失败状态');
  assert.eq(fm.isFallback('lxgw'), true, '回退标记');
  assert.eq(st._map.get('landscape.fontLoaded.lxgw'), undefined, '失败不写缓存标记（下次重试）');

  const okWx = { loadFontFace: (o) => o.success() };
  const fm2 = createFontManager({ wxApi: okWx, storage: st });
  assert.eq(await fm2.load('lxgw'), true, '加载成功');
  assert.eq(fm2.isFallback('lxgw'), false, '成功后非回退');
  assert.eq(st._map.get('landscape.fontLoaded.lxgw'), 1, '成功写缓存标记');

  const fm3 = createFontManager({ wxApi: {}, storage: memStorage() });
  assert.eq(await fm3.load('longcang'), false, '无 loadFontFace 时安全回退不抛错');
});

test('横置-成员权限：无授权隐藏＋/修改/删除，主人全显', () => {
  const none = LC.permissionsFor({ isOwner: false, switches: {} });
  assert.eq(none.canAdd, false, '成员无可新增→隐藏＋');
  assert.eq(none.canEdit, false, '成员无可修改→隐藏修改');
  assert.eq(none.canDelete, false, '成员无可删除→隐藏删除');
  assert.eq(none.canView, true, '仅查看恒开');
  const some = LC.permissionsFor({ isOwner: false, switches: { view: true, add: true } });
  assert.eq(some.canAdd, true, '开了可新增才显示＋');
  assert.eq(some.canEdit, false, '未开可修改仍隐藏');
  const owner = LC.permissionsFor({ isOwner: true });
  assert(owner.canAdd && owner.canEdit && owner.canDelete, '主人全显');
});

test('横置-转屏关闭半屏：方向翻转时详情与面板先关', () => {
  const m = LC.createOrientationMachine();
  m.resize(390, 844); // 竖屏进入
  m.openDetail();
  m.openPanel();
  const r = m.resize(844, 390); // 转横屏
  assert.eq(r.closedOnFlip, true, '翻转时报告已关闭半屏');
  assert.eq(m.state.detailOpen, false, '详情已关');
  assert.eq(m.state.panelOpen, false, '面板已关');
  assert.eq(r.isLandscape, true, '横屏态');
  // 同方向内尺寸变化不误关
  m.openDetail();
  const r2 = m.resize(850, 390);
  assert.eq(r2.closedOnFlip, false, '同方向不关');
  assert.eq(m.state.detailOpen, true, '详情保留');
});

test('横置-金额一致性：大写与分值一致、半屏金额两位小数', () => {
  const built = LC.buildColumns([{ id: '1', name: '张三', amountFen: 100000, tagId: 'jiehun' }], {});
  const col = built.columns[built.columns.length - 1];
  assert.eq(col.amountText, amountToChineseUpper(100000), '大写与 core 转换一致');
  assert.eq(col.amountText, '壹仟元整', '1000元→壹仟元整');
  assert.eq(col.amountChars.map((c) => c.ch).join(''), col.amountText, '逐字拼回一致');
  assert.eq(LC.detailAmountText(1250), '12.50', '半屏金额两位小数');
  assert.eq(LC.detailAmountText(100005), '1000.05', '带分不四舍五入');
});

test('横置-空列格子：格子印满整幅，空列数=12-记录数且只有线框', () => {
  const recs = [1, 2, 3, 4].map((i) => ({ id: String(i), name: '张三', amountFen: 10000, tagId: 'jiehun' }));
  const built = LC.buildColumns(recs, {});
  assert.eq(built.totalGrid, 12, '总列数 12');
  assert.eq(built.emptyCount, 8, '空列 = 12 - 4');
  assert.eq(built.columns.length, 12, '渲染列数 12');
  const empties = built.columns.filter((c) => c.empty);
  assert.eq(empties.length, 8, '空列对象数');
  assert(empties.every((c) => !c.nameChars && !c.amountChars), '空列只有线框无内容');
  assert.eq(built.columns[0].empty, true, '空列在左（display 顺序）');
  assert.eq(built.columns[11].empty, false, '最右是第一条记录');
  const zero = LC.buildColumns([], {});
  assert.eq(zero.emptyCount, 12, '零记录时 12 列全空');
  const many = LC.buildColumns(Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: '张三', amountFen: 1, tagId: 'jiehun' })), {});
  assert.eq(many.emptyCount, 0, '超 12 条无空列');
  assert.eq(many.totalGrid, 15, '超屏按记录数扩展');
});

test('横置-缩放界内：4字名/5字名/6字金额系数在 (0,1] 且不越区', () => {
  const n4 = LC.layoutName('欧阳修远');
  assert(n4.scale > 0 && n4.scale <= 1, '4字名系数在界内');
  assert.eq(n4.scale, 0.75, '4字名系数 3/4');
  const lastTop = n4.chars[n4.chars.length - 1].top;
  assert(lastTop + n4.pitch <= LC.SPEC.NAME_H + 0.01, '4字名末字不越姓名区');
  const n5 = LC.layoutName('欧阳修远明');
  assert.eq(n5.scale, 0.6, '5字名系数 3/5');
  const a6 = LC.layoutAmount(150000); // 壹仟伍佰元整 = 6 字
  assert.eq(a6.text, '壹仟伍佰元整', '6字金额');
  assert(a6.scale > 0 && a6.scale <= 1, '6字金额系数在界内');
  const aLast = a6.chars[a6.chars.length - 1].top;
  assert(aLast + a6.pitch <= LC.SPEC.AMT_H + 0.01, '6字金额末字不越金额区');
  // 2字名占 1、3 字位；1字居中
  const n2 = LC.layoutName('欧阳');
  assert.eq(n2.chars[0].top, 0, '2字名首字第1位');
  assert.eq(n2.chars[1].top, 52, '2字名末字第3位');
  const n1 = LC.layoutName('王');
  assert.eq(n1.chars[0].top, 26, '1字名居中');
});

test('横置-窗口化：占位+渲染宽度守恒', () => {
  const w = LC.windowRange({ total: 20, scrollLeftPx: 0, colWPx: 64.5, viewportPx: 780, buffer: 2 });
  assert.eq(w.start, 0, '起始 0');
  assert.eq(w.leftSpacerPx + (w.end - w.start) * 64.5 + w.rightSpacerPx, 20 * 64.5, '总宽守恒');
  const w2 = LC.windowRange({ total: 20, scrollLeftPx: 64.5 * 10, colWPx: 64.5, viewportPx: 780, buffer: 2 });
  assert.eq(w2.start, 8, '滚动后窗口前移（含 buffer）');
  assert.eq(w2.leftSpacerPx, 8 * 64.5, '左占位');
});

test('横置-请横屏文案：与定版图30逐字一致', () => {
  assert.eq(LC.ROTATE_COPY.main, '请把手机横过来，礼单本就会铺开啦', '主提示');
  assert.eq(LC.ROTATE_COPY.sub, '横置礼单本仅支持横屏使用', '次提示');
  assert.eq(LC.ROTATE_COPY.lock, '没有反应？请先在手机控制中心关闭"竖屏锁定"', '锁屏提示');
  assert.eq(LC.ROTATE_COPY.backButton, '返回竖屏', '按钮'); // 2026-10-22 用户真机反馈改名（原定版图30「切换回竖置样式」）
  assert.eq(LC.SPEC.FONT_CREDIT, '横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体（SIL OFL 1.1）', '字体署名');
});
