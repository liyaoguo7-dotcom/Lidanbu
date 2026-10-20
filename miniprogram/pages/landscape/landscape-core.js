/**
 * 礼单簿 · 横置礼单本核心逻辑（纯 JS，无 wx 依赖，可被 tests/ 直接 require）
 *
 * 定版依据：《横置总规格》(muse-7) + 后续修正，仓库提交 039bad7 定版图 33–41。
 * 页面（pages/landscape/*）只调本模块算版式/主题/权限，不在页面里写死数字。
 *
 * 未核实/待真机联调项（集中在本文件顶部开关，联调后改这里，不要散落到页面）：
 * - WXSS 背景图用 PNG 瓦片 base64（landscape-tiles.js），真机平铺表现待验；
 * - CSS env(safe-area-inset-*) 可用性未核实 → 安全区一律走 JS 读 wx.getWindowInfo，
 *   本模块只提供开关 USE_ENV_SAFE_AREA=false，页面不要用 env()；
 * - 安卓厂商 ROM 旋转行为差异待真机矩阵验证（见 docs/wireframes/landscape/横置实现方式说明.md）。
 */
const { amountToChineseUpper, formatAmount } = require('../../core/format.js');
const TILES = require('./landscape-tiles.js');

/** 待联调开关：env() 安全区（未核实，保持 false，安全区走 JS 注入） */
const USE_ENV_SAFE_AREA = false;

/** 版式定版数值（基准画布 844×390 逻辑像素，其他尺寸按 scale=窗口宽/844 等比） */
const SPEC = {
  BASE_W: 844, BASE_H: 390,
  MARGIN_V: 48,          // 上/下留白高
  PAPER_H: 294,          // 纸面高（含边框）
  SCROLL_W: 32,          // 左右卷轴位宽
  COL_W: 64.5,           // 固定列宽
  COLS_PER_SCREEN: 12,   // 一屏列数（格子印满整幅纸面的列数下限）
  INNER_PAD: 6,          // 列内上下各留
  NAME_H: 78, NAME_FONT: 22, NAME_PITCH: 26, NAME_SLOTS: 3,
  GAP: 10,
  MID_H: 52, MID_FONT: 22, MID_PITCH: 26,
  AMT_H: 96, AMT_FONT: 20, AMT_PITCH: 24, AMT_SLOTS: 4,
  PLUS_VISUAL: 31,       // ＋视觉直径（约原来的 70%）
  PLUS_TOUCH: 44,        // ＋可点范围（不缩小）
  FONT_CREDIT: '横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体（SIL OFL 1.1）',
};

/** 列内总高（校验用）：6+78+10+52+10+96+6 = 258 */
const COL_INNER_H = SPEC.INNER_PAD * 2 + SPEC.NAME_H + SPEC.GAP + SPEC.MID_H + SPEC.GAP + SPEC.AMT_H;

/** 两位小数舍入（像素用；注意：金额格式化一律走 core/format，本函数只处理像素值） */
const round2 = (v) => Math.round(v * 100) * 0.01;

/** 按窗口宽算等比缩放后的尺寸（页面 setData 用） */
function scaledSpec(windowWidth) {
  const s = windowWidth / SPEC.BASE_W;
  const r = (v) => round2(v * s);
  return {
    scale: s,
    marginV: r(SPEC.MARGIN_V), paperH: r(SPEC.PAPER_H), scrollW: r(SPEC.SCROLL_W),
    colW: r(SPEC.COL_W), innerPad: r(SPEC.INNER_PAD),
    nameH: r(SPEC.NAME_H), nameFont: r(SPEC.NAME_FONT), namePitch: r(SPEC.NAME_PITCH),
    gap: r(SPEC.GAP), midH: r(SPEC.MID_H), midFont: r(SPEC.MID_FONT), midPitch: r(SPEC.MID_PITCH),
    amtH: r(SPEC.AMT_H), amtFont: r(SPEC.AMT_FONT), amtPitch: r(SPEC.AMT_PITCH),
    plusVisual: r(SPEC.PLUS_VISUAL), plusTouch: r(SPEC.PLUS_TOUCH),
  };
}

/** 字体表：校准系数使三款字体同格视觉等大（定版：文楷 1.00 / 马善政 1.05 / 龙藏 1.20） */
const FONTS = [
  { id: 'lxgw', name: '霞鹜文楷', family: 'LxgwWenKai', calibration: 1.00, file: 'lxgw-wenkai.woff2' },
  { id: 'mashanzheng', name: '马善政毛笔体', family: 'MaShanZheng', calibration: 1.05, file: 'mashanzheng.woff2' },
  { id: 'longcang', name: '龙藏体', family: 'LongCang', calibration: 1.20, file: 'longcang.woff2' },
];
const SONGTI_STACK = '"Songti SC","STSong","Noto Serif CJK SC",SimSun,serif';
const KAITI_STACK = '"KaiTi","STKaiti","楷体"';

function fontById(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }
/** 经校准后的实际字号 */
function calibratedSize(basePx, fontId) {
  return round2(basePx * fontById(fontId).calibration);
}
/**
 * 所选字体的 font-family 栈：所选字体 → 系统楷体 → 宋体栈。
 * 缺字靠这条回退链逐字回退，保证不出方框（真机回退表现待联调验证）。
 */
function selectedStack(fontId) {
  return `"${fontById(fontId).family}",${KAITI_STACK},${SONGTI_STACK}`;
}

/**
 * 中段文字分工（定版规则）：
 * - 贺礼 / 奠仪：固定印刷宋体（fontRole='songti'）
 * - 礼金：跟随所选字体（fontRole='selected'）
 * - 姓名 / 金额：跟随所选字体
 */
function fontRoleForMid(midText) {
  return midText === '礼金' ? 'selected' : 'songti';
}

/** 标签 → 中段文字（v3.1 规则：压岁/探望/其他=礼金，白事=奠仪，其余=贺礼） */
const MID_BY_TAG = {
  jiehun: '贺礼', shengzi: '贺礼', shengri: '贺礼', shengxue: '贺礼', qiaoqian: '贺礼', dashou: '贺礼',
  baishi: '奠仪', yasui: '礼金', tanwang: '礼金', qita: '礼金',
};
function midTextForTag(tagId) { return MID_BY_TAG[tagId] || '贺礼'; }

/**
 * 主题表（6 种样式定版；颜色取自定版图 33–38 实测值）。
 * 纹路覆盖三处：留白（marginTile）+ 纸面背景（paperTile）+ 卷轴（scrollImg 按主题换色）。
 * 白事（funeral）：全页无红色——plus/高亮/中段/列线均为黑灰系，noRed=true 供测试与页面断言。
 */
const THEMES = {
  classic: {
    id: 'classic', name: '传统经典', kind: 'festive',
    lineColor: '#B8322A', frameColor: '#B8322A', paperBg: '#FFF8F2', marginBg: '#F9E9DC',
    midColor: '#B8322A', inkColor: '#2B2B2B', plusBg: '#C0453C',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-classic.png',
    marginTile: TILES.CLASSIC.margin, paperTile: TILES.CLASSIC.paper, noRed: false,
  },
  blue: {
    id: 'blue', name: '淡蓝水波纹', kind: 'festive',
    lineColor: '#5B8DB0', frameColor: '#5B8DB0', paperBg: '#F4F9FC', marginBg: '#D9E7F1',
    midColor: '#4A7CA5', inkColor: '#2B2B2B', plusBg: '#7FA8C9',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-blue.png',
    marginTile: TILES.BLUE.margin, paperTile: TILES.BLUE.paper, noRed: false,
  },
  pear: {
    id: 'pear', name: '梨花白', kind: 'festive',
    // 定版图 35：纸面为红线纸（列线/中段红），留白与卷轴为淡金梨花
    lineColor: '#B8322A', frameColor: '#B8322A', paperBg: '#FFF8F2', marginBg: '#FBF6EC',
    midColor: '#B8322A', inkColor: '#2B2B2B', plusBg: '#C9A24B',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-pear.png',
    marginTile: TILES.PEAR.margin, paperTile: TILES.PEAR.paper, noRed: false,
  },
  cloud: {
    id: 'cloud', name: '祥云金', kind: 'festive',
    lineColor: '#A67C2E', frameColor: '#A67C2E', paperBg: '#FDF8EC', marginBg: '#F5EAD0',
    midColor: '#A67C2E', inkColor: '#2B2B2B', plusBg: '#C39A3B',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-cloud.png',
    marginTile: TILES.CLOUD.margin, paperTile: TILES.CLOUD.paper, noRed: false,
  },
  bamboo: {
    id: 'bamboo', name: '竹青', kind: 'festive',
    lineColor: '#3E7C5B', frameColor: '#3E7C5B', paperBg: '#F2F8F3', marginBg: '#DCEDE1',
    midColor: '#3E7C5B', inkColor: '#2B2B2B', plusBg: '#6FA585',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-bamboo.png',
    marginTile: TILES.BAMBOO.margin, paperTile: TILES.BAMBOO.paper, noRed: false,
  },
  funeral: {
    id: 'funeral', name: '白事', kind: 'funeral',
    lineColor: '#3B4046', frameColor: '#3B4046', paperBg: '#FFFFFF', marginBg: '#F2F2F2',
    midColor: '#222222', inkColor: '#222222', plusBg: '#3B4046',
    highlightBorder: '#3B4046', highlightBg: 'rgba(59,64,70,0.08)',
    scrollImg: '/assets/scrolls/scroll-funeral.png',
    marginTile: TILES.FUNERAL.margin, paperTile: TILES.FUNERAL.paper, noRed: true,
  },
};
const THEME_LIST = ['classic', 'blue', 'pear', 'cloud', 'bamboo', 'funeral'].map((id) => THEMES[id]);
function themeById(id) { return THEMES[id] || THEMES.classic; }

/** 收礼页样式自动判定：礼薄标签是白事 → 强制白事样式；否则用用户所选样式 */
function resolveReceiveTheme(eventTagId, selectedStyleId) {
  return eventTagId === 'baishi' ? 'funeral' : (THEMES[selectedStyleId] ? selectedStyleId : 'classic');
}

/** 姓名逐字布局（返回 [{ch, top}]，单位为基准 px，页面按 scale 放大） */
function layoutName(name) {
  const chars = Array.from(String(name || ''));
  const n = chars.length;
  if (n === 0) return { chars: [], scale: 1, fontSize: SPEC.NAME_FONT, pitch: SPEC.NAME_PITCH };
  if (n <= SPEC.NAME_SLOTS) {
    // 3 字占满；2 字占第 1、3 字位；1 字居中（第 2 字位）
    const slots = n === 1 ? [1] : n === 2 ? [0, 2] : [0, 1, 2];
    return {
      scale: 1, fontSize: SPEC.NAME_FONT, pitch: SPEC.NAME_PITCH,
      chars: chars.map((ch, i) => ({ ch, top: slots[i] * SPEC.NAME_PITCH })),
    };
  }
  // 4 字以上：整体按比例缩进同样的 78 高内
  const scale = SPEC.NAME_SLOTS / n;
  const pitch = SPEC.NAME_H / n;
  return {
    scale, fontSize: round2(SPEC.NAME_FONT * scale), pitch,
    chars: chars.map((ch, i) => ({ ch, top: round2(i * pitch) })),
  };
}

/** 金额逐字布局：固定 4 字位同起同收；超 4 字按比例缩字号字距压入 96 */
function layoutAmount(amountFen) {
  const text = amountToChineseUpper(amountFen);
  const chars = Array.from(text);
  const n = chars.length;
  if (n <= SPEC.AMT_SLOTS) {
    return {
      text, scale: 1, fontSize: SPEC.AMT_FONT, pitch: SPEC.AMT_PITCH,
      chars: chars.map((ch, i) => ({ ch, top: i * SPEC.AMT_PITCH })),
    };
  }
  const scale = SPEC.AMT_SLOTS / n;
  const pitch = SPEC.AMT_H / n;
  return {
    text, scale, fontSize: round2(SPEC.AMT_FONT * scale), pitch,
    chars: chars.map((ch, i) => ({ ch, top: round2(i * pitch) })),
  };
}

/**
 * 构建列模型。
 * records：账本顺序（records[0] 在纸面最右）。每条 {id, name, amountFen, tagId}
 * 返回 display 顺序（左→右）的列数组：左侧先空格子，再 records 逆序（最右 = records[0]）。
 * 格子印满整幅纸面：总列数 = max(12, 记录数)，空列只有线框、内容为空。
 */
function buildColumns(records, opts = {}) {
  const list = Array.isArray(records) ? records : [];
  const totalGrid = Math.max(SPEC.COLS_PER_SCREEN, list.length);
  const emptyCount = totalGrid - list.length;
  const fontId = opts.fontId || 'lxgw';
  const cols = [];
  for (let i = 0; i < emptyCount; i++) {
    cols.push({ key: `empty-${i}`, empty: true, recordId: null });
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const midText = opts.midText || midTextForTag(r.tagId);
    const name = layoutName(r.name);
    const amt = layoutAmount(r.amountFen);
    cols.push({
      key: `rec-${r.id}`,
      empty: false,
      recordId: r.id,
      name: r.name,
      nameChars: name.chars, nameFontSize: calibratedSize(name.fontSize, fontId), nameScale: name.scale,
      midText,
      midRole: fontRoleForMid(midText),
      midChars: Array.from(midText).map((ch, i) => ({ ch, top: i * SPEC.MID_PITCH })),
      // 送礼页奠仪列：中段字黑色（39 号定版）；其余列用主题中段色（页面层决定）
      midBlack: midText === '奠仪',
      amountText: amt.text,
      amountChars: amt.chars, amountFontSize: calibratedSize(amt.fontSize, fontId), amountScale: amt.scale,
      amountFen: r.amountFen,
    });
  }
  return { columns: cols, emptyCount, totalGrid, recordCount: list.length };
}

/**
 * 滚动窗口化：只渲染可视范围附近的列。
 * 入参为 display 顺序的滚动量；返回应渲染的 [start,end) 与左右占位宽度，
 * 页面用占位 view 撑住滚动几何，滑动不跳。
 */
function windowRange({ total, scrollLeftPx, colWPx, viewportPx, buffer = 2 }) {
  if (total <= 0 || colWPx <= 0) return { start: 0, end: 0, leftSpacerPx: 0, rightSpacerPx: 0 };
  const first = Math.floor(scrollLeftPx / colWPx);
  const visible = Math.ceil(viewportPx / colWPx);
  const start = Math.max(0, first - buffer);
  const end = Math.min(total, first + visible + buffer);
  return { start, end, leftSpacerPx: start * colWPx, rightSpacerPx: (total - end) * colWPx };
}

/**
 * 横竖屏状态机：转屏（orientation 变化）时先关半屏详情与样式面板，再切态。
 * 页面 onResize 调 machine.resize(w,h) 并按返回的 closedOnFlip 标记做 setData。
 */
function createOrientationMachine() {
  const state = { orientation: 'portrait', detailOpen: false, panelOpen: false };
  return {
    state,
    openDetail() { state.detailOpen = true; },
    closeDetail() { state.detailOpen = false; },
    openPanel() { state.panelOpen = true; },
    closePanel() { state.panelOpen = false; },
    resize(windowWidth, windowHeight) {
      const next = windowWidth > windowHeight ? 'landscape' : 'portrait';
      let closedOnFlip = false;
      if (next !== state.orientation) {
        if (state.detailOpen || state.panelOpen) closedOnFlip = true;
        state.detailOpen = false;
        state.panelOpen = false;
        state.orientation = next;
      }
      return { orientation: state.orientation, isLandscape: next === 'landscape', closedOnFlip };
    },
  };
}

const FONT_KEY = 'landscape.fontId';
const STYLE_KEY = 'landscape.styleId';
/**
 * 字体/样式选择存储：两个字段分开存（互不重置），与会员状态无关——
 * 会员到期回竖置后选择保留、续费打开横置即恢复（只存不用）。
 * storage 注入 {get(key), set(key, value)}，页面传 wx storage 适配，测试传内存实现。
 */
function createSelectionStore(storage) {
  return {
    keys: { font: FONT_KEY, style: STYLE_KEY },
    getFont() { return fontById(storage.get(FONT_KEY) || 'lxgw').id; },
    getStyle() { const s = storage.get(STYLE_KEY); return THEMES[s] ? s : 'classic'; },
    setFont(id) { storage.set(FONT_KEY, fontById(id).id); },
    setStyle(id) { storage.set(STYLE_KEY, THEMES[id] ? id : 'classic'); },
    getPrefs() { return { fontId: this.getFont(), styleId: this.getStyle() }; },
  };
}

/**
 * 按钮权限判定（成员视角按主人授权开关隐藏按钮；core 每次写操作仍会再校验）。
 * switches: {view, add, edit, del, export}（view 恒开）
 */
function permissionsFor({ isOwner, switches } = {}) {
  if (isOwner) return { canAdd: true, canEdit: true, canDelete: true, canView: true };
  const sw = switches || {};
  return {
    canView: true,
    canAdd: !!sw.add,
    canEdit: !!sw.edit,
    canDelete: !!sw.del,
  };
}

/** 半屏详情金额：两位小数（收礼/送礼详情同规则） */
function detailAmountText(amountFen) { return formatAmount(amountFen); }

/** 请横屏页文案（与定版图 30 逐字一致，不得改动） */
const ROTATE_COPY = {
  title: '横置礼单本',
  main: '请把手机横过来，礼单本就会铺开啦',
  sub: '横置礼单本仅支持横屏使用',
  lock: '没有反应？请先在手机控制中心关闭"竖屏锁定"',
  backButton: '切换回竖置样式',
};

module.exports = {
  USE_ENV_SAFE_AREA, SPEC, COL_INNER_H, scaledSpec, round2,
  FONTS, fontById, calibratedSize, selectedStack, SONGTI_STACK, KAITI_STACK,
  fontRoleForMid, MID_BY_TAG, midTextForTag,
  THEMES, THEME_LIST, themeById, resolveReceiveTheme,
  layoutName, layoutAmount, buildColumns, windowRange,
  createOrientationMachine, createSelectionStore, permissionsFor,
  detailAmountText, ROTATE_COPY,
};
