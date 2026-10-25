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

test('横置-定版数值：列宽50/姓名区104/中段区52/金额区118.5/墨迹间距4/列内总高290', () => {
  assert.eq(LC.SPEC.COL_W, 50, '列宽（任务AC 第 9 项：56→50 再窄一档；历程 64.5→56→50）');
  assert.eq(LC.SPEC.NAME_H, 104, '姓名区（2026-10-25 真机反馈上下往中间收：114.5→104，见 landscape-core COL_INNER_H 注释）');
  assert.eq(LC.SPEC.NAME_TOP, 11.25, '姓名区顶距（原 6＋收缩量一半 5.25，整段中心不动）');
  assert.eq(LC.SPEC.MID_H, 52, '中段区');
  assert.eq(LC.SPEC.AMT_H, 118.5, '金额区（本轮模型实测校准定版；大于姓名区——真机反馈金额占位偏小）');
  assert.eq(LC.SPEC.GAP, 4, '姓名末字墨迹↔贺礼、贺礼↔金额首字墨迹 间距 4（任务AF真机定版；历程 2→3.5→4）');
  assert.eq(LC.SPEC.MID_FONT, 23, '中段字号 23（比姓名/金额 22 大一号，任务AF真机定版）');
  assert.eq(LC.SPEC.MID_SHIFT_UP, 3, '中段整体上移 3');
  assert.eq(LC.SPEC.MARGIN_B, 30, '下留白 30（真机反馈收窄；上留白 48 与纸面高不变）');
  assert.eq(LC.COL_INNER_H, 290, '列内总高 = 纸面 294 − 边框 4（任务AC 纠正旧 258 名义值）');
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
    const col = built.columns[0];
    assert.eq(col.midRole, 'songti', `${f.id} 下奠仪恒宋体`);
  }
  assert.eq(LC.resolveReceiveTheme('baishi', 'classic'), 'funeral', '白事礼薄强制白事样式');
});

test('横置-字体分工：中段词只剩贺礼/奠仪且恒宋体（任务AA 废除「礼金」中段词）', () => {
  assert.eq(LC.fontRoleForMid('贺礼'), 'songti', '贺礼恒宋体');
  assert.eq(LC.fontRoleForMid('奠仪'), 'songti', '奠仪恒宋体');
  // 旧口径「礼金随所选字体」已废除：任何标签的中段词只会是贺礼/奠仪
  const g = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: 'yasui' }], {});
  assert.eq(g.columns[0].midText, '贺礼', '压岁标签→贺礼（任务AA）');
  assert.eq(g.columns[0].midRole, 'songti', '贺礼列 role=songti');
  const h = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: 'jiehun' }], {});
  assert.eq(h.columns[0].midText, '贺礼', '结婚→贺礼');
  assert.eq(h.columns[0].midRole, 'songti', '贺礼列 role=songti');
  for (const tag of ['shengri', 'qiaoqian', 'tanwang', 'qita']) {
    const b = LC.buildColumns([{ id: '1', name: '张三', amountFen: 10000, tagId: tag }], {});
    assert.eq(b.columns[0].midText, '贺礼', `${tag}→贺礼`);
  }
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
  assert.eq(st._map.get('landscape.fontLoaded.v7.lxgw'), undefined, '失败不写缓存标记（下次重试）');

  const okWx = { loadFontFace: (o) => o.success() };
  const fm2 = createFontManager({ wxApi: okWx, storage: st });
  assert.eq(await fm2.load('lxgw'), true, '加载成功');
  assert.eq(fm2.isFallback('lxgw'), false, '成功后非回退');
  assert.eq(st._map.get('landscape.fontLoaded.v7.lxgw'), 1, '成功写缓存标记');

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
  const col = built.columns[0];
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
  assert.eq(built.columns[0].empty, false, '最左是第一条记录（2026-10-22 定版：第一条最左）');
  assert.eq(built.columns[11].empty, true, '空列补在最后一条记录右侧');
  assert.eq(built.columns.map((c) => c.recordId).slice(0, 4).join(','), '1,2,3,4', '记录按账本顺序从左到右排');
  const zero = LC.buildColumns([], {});
  assert.eq(zero.emptyCount, 12, '零记录时 12 列全空');
  const many = LC.buildColumns(Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: '张三', amountFen: 1, tagId: 'jiehun' })), {});
  assert.eq(many.emptyCount, 0, '超 12 条无空列');
  assert.eq(many.totalGrid, 15, '超屏按记录数扩展');
});

test('横置-均布不叠字：首末锚定+字号放不下才缩+字距恒≥字号', () => {
  // 2026-10-22 晚定版：姓名首字区顶、末字区底；金额首字区顶、末字区底，中间均布
  const n4 = LC.layoutName('欧阳修远');
  assert.eq(n4.scale, 1, '4字名放得下不缩（104/4=26≥22）');
  assert.eq(n4.chars[0].top, 0, '4字名首字区顶');
  assert.eq(n4.chars[3].top + n4.fontSize, LC.SPEC.NAME_H, '4字名末字贴区底');
  const n5 = LC.layoutName('欧阳修远明轩'); // 6 字名（2026-10-25 区高收至 104：104/6≈17.33；5 字名 104/5=20.8 也开始微缩，属不叠字规则内）
  assert(Math.abs(n5.fontSize - 17.33) < 0.011, '6字名字号缩到 104/6≈17.33');
  assert(n5.pitch >= n5.fontSize - 0.011, '6字名字距≥字号不叠字');
  const a6 = LC.layoutAmount(150000); // 壹仟伍佰元整 = 6 字
  assert.eq(a6.text, '壹仟伍佰元整', '6字金额');
  assert.eq(a6.fontSize, 19.75, '6字金额字号缩到 118.5/6（金额区本轮 115.5→118.5）');
  assert(a6.pitch >= a6.fontSize - 0.011, '6字金额字距≥字号不叠字');
  const aLast = a6.chars[a6.chars.length - 1].top;
  assert(Math.abs(aLast + a6.fontSize - LC.SPEC.AMT_H) < 0.011, '6字金额末字字形盒贴区底');
  // 2字名：首字区顶、末字区底（旧字位制已废）；1字名放第一个字位置
  const n2 = LC.layoutName('欧阳');
  assert.eq(n2.chars[0].top, 0, '2字名首字区顶');
  assert.eq(n2.chars[1].top, LC.SPEC.NAME_H - 22, '2字名末字区底');
  const n1 = LC.layoutName('王');
  assert.eq(n1.chars[0].top, 0, '1字名在第一个字位置');
  // 字号口径（任务AF 更新）：姓名/金额默认 22，中段 23 大一号
  const n3 = LC.layoutName('张建国');
  assert.eq(n3.fontSize, LC.SPEC.NAME_FONT, '3字名字号=姓名默认 22');
  assert.eq(LC.SPEC.MID_FONT, LC.SPEC.NAME_FONT + 1, '中段比姓名大一号（23）');
  const a4 = LC.layoutAmount(100000);
  assert.eq(a4.fontSize, LC.SPEC.AMT_FONT, '4字金额字号=金额默认 22');
  // 三款字体校准下同样不叠字（按校准后实际字号验：字距≥实际字号、末字不越区）
  for (const fid of ['lxgw', 'mashanzheng', 'longcang']) {
    const built = LC.buildColumns([{ id: 'x', name: '欧阳修远', amountFen: 150000, tagId: 'jiehun' }], { fontId: fid });
    const col = built.columns[0];
    const ac = col.amountChars;
    for (let i = 1; i < ac.length; i++) {
      assert(ac[i].top - ac[i - 1].top >= col.amountFontSize - 0.6, `${fid} 6字金额字距≥实际字号`);
    }
    assert(ac[ac.length - 1].top + col.amountFontSize <= LC.SPEC.AMT_H + 0.6, `${fid} 金额末字不越区`);
    const nc = col.nameChars;
    for (let i = 1; i < nc.length; i++) {
      assert(nc[i].top - nc[i - 1].top >= col.nameFontSize - 0.6, `${fid} 4字名字距≥实际字号`);
    }
    assert(nc[nc.length - 1].top + col.nameFontSize <= LC.SPEC.NAME_H + 0.6, `${fid} 姓名末字不越区`);
  }
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
  assert.eq(LC.ROTATE_COPY.backButton, '切换回竖置样式', '按钮'); // 定版图30原文（2026-10-22 曾改名「返回竖屏」，同日用户决定回退）
  assert.eq(LC.SPEC.FONT_CREDIT, '横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体（SIL OFL 1.1）', '字体署名');
});
