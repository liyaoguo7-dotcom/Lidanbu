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
  MARGIN_V: 48,          // 上留白高
  MARGIN_B: 30,          // 下留白高（任务AF真机反馈：下方留白收窄 48→30；上留白与纸面高不变，列内几何不受影响）
  PAPER_H: 294,          // 纸面高（含边框）
  SCROLL_W: 32,          // 左右卷轴位宽
  COL_W: 50,             // 固定列宽（2026-10-23 任务AC 第 9 项：56→50，用户反馈左右再窄一点；历程 64.5→56→50）
  COLS_PER_SCREEN: 12,   // 一屏列数（格子印满整幅纸面的列数下限）
  INNER_PAD: 6,          // 列内上下各留
  NAME_H: 104, NAME_FONT: 22, NAME_PITCH: 26, NAME_SLOTS: 3, // 历程：AC 反推 116 → AE(GAP 3.5) 114.5 → AF 校准 114.5 → 2026-10-25 真机反馈「人名上下往中间缩小一点」收 10.5 至 104，区顶同步下移（NAME_TOP）保整段中心不动
  NAME_TOP: 11.25, // 姓名区顶距（= 原顶距 6 + 收缩量 10.5 的一半 5.25）：姓名整段中心与旧版一致，只是上下往中间收
  GAP: 4,                // 姓名末字墨迹底↔贺礼首字墨迹顶、贺礼末字墨迹底↔金额首字墨迹顶 的目标间距（历程：5→2 任务AC → 3.5 任务AE → 4 本轮，用户逐轮真机看图定版）
  MID_H: 52, MID_FONT: 23, MID_PITCH: 27, // 中段字号 23（任务AF真机反馈：贺礼/奠仪比姓名金额大一号，姓名/金额仍 22）；字位距随字号 +1
  MID_SHIFT_UP: 3,       // 中段整体上移 3px（任务AF真机反馈）：区位 = 列高正中 − 3
  AMT_H: 118.5, AMT_FONT: 22, AMT_PITCH: 24, AMT_SLOTS: 4, // 历程：AC 反推 117 → AE(GAP 3.5) 115.5 → 本轮 117（中段上移后墨迹底抬高、为保 GAP 4 金额区反增；金额区大于姓名区——真机反馈金额占位偏小、名字中间太空）
  AMT_BOTTOM_PAD: 4,     // 金额区底距列底（任务AA 模型实测补偿）：对称位本应 =INNER_PAD(6)，但真 LXGW
                         // 渲染下「整」字墨迹下轴承≈2.5px、姓名首字上轴承≈0.5px，故区底下移 2px 至 4，
                         // 使两侧墨迹空白同为 ≈6.5px（模型实测主列差 0.5px）；个别姓名用字（如「王」）
                         // 墨迹上轴承偏大属字形本身，不随版式变
  PLUS_VISUAL: 31,       // ＋视觉直径（约原来的 70%）
  PLUS_TOUCH: 44,        // ＋可点范围（不缩小）
  FONT_CREDIT: '横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体（SIL OFL 1.1）',
};

/** 列内总高（校验用）= 纸面高 PAPER_H 294 − 上下边框 4 = 290（基准画布实测几何，
 * 2026-10-23 任务AC 第 9 项纠正：旧注释的 258 名义堆叠从未在渲染中成立——三段是
 * 独立锚定的：姓名区顶距 6、金额区底距 4、中段区钉在列正中，与 258 堆叠无关，
 * 旧版式实测墨迹间距高达 28/25px，正是用户"空白太大"的来源）。
 * 现行锚定几何（列内容高 290）：姓名区 11.25..115.25（高 104，2026-10-25 上下往中间收，中心与旧版 6..120.5 一致）；
 * 中段区上移 3 后 116..168（区高 52、字号 23/字位距 27）；金额区 167.5..286
 * （高 118.5、底距 4）。区高经模型实测校准（gen-model+measure2，LXGW）：
 * 姓名墨迹 8.5..116、中段墨迹 120.5..165.5、金额墨迹 170..283.5 →
 * 两侧墨迹间距恰 4.0/4.0；字数变体列 3.0~4.0（字形轴承差）。
 * （历程：GAP 2 任务AC → 3.5 任务AE → 4 本轮；中段字号 22→23 大一号、上移 3。） */
const COL_INNER_H = 290;

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
    nameH: r(SPEC.NAME_H), nameTop: r(SPEC.NAME_TOP), nameFont: r(SPEC.NAME_FONT), namePitch: r(SPEC.NAME_PITCH),
    gap: r(SPEC.GAP), midH: r(SPEC.MID_H), midFont: r(SPEC.MID_FONT), midPitch: r(SPEC.MID_PITCH),
    marginB: r(SPEC.MARGIN_B), midShift: r(-SPEC.MID_SHIFT_UP),
    amtH: r(SPEC.AMT_H), amtFont: r(SPEC.AMT_FONT), amtPitch: r(SPEC.AMT_PITCH),
    amtBottomPad: r(SPEC.AMT_BOTTOM_PAD),
    plusVisual: r(SPEC.PLUS_VISUAL), plusTouch: r(SPEC.PLUS_TOUCH),
  };
}

/** 字体表：校准系数使三款字体同格视觉等大（定版：文楷 1.00 / 马善政 1.05 / 龙藏 1.20） */
/**
 * 卷轴贴合几何（AT-6 定版 → AV 批改锚，用户 2026-10-27）。
 * 资产量测（脚本逐行 alpha 扫描 assets/scrolls/scroll-*.png，6 图同模不同色）：
 * - PNG 88×836；两端帽子组件各 23 行（行 0..22 / 813..835）；
 * - 中间等宽杆身行 23..812（790 行），实绘 x∈[15,72]（宽 58，两侧透明各 15）。
 * AT-6 旧锚：杆身段 [23,813) 与纸面上下边对齐，帽子上下各探出 8.56（基准画布）。
 * AV 改锚（用户看 AU 预览后亲定）：「棍杆上下那里有个横线，礼单和那个横线对齐」——
 * 每根杆在帽下都有一条醒目的分界横线（杆身装饰环／纹带的外缘亮线），旧锚下这条线
 * 落在纸面跨度以内（五杆约 6.7px、白事纹带上沿约 4.1px），纸边没压在线上。
 * 新锚：上下两条分界横线分别与纸面上下边精确对齐，整图据此等比缩放/定位，
 * 帽子探出量为派生值。分界线逐张量测（alpha/均值色行扫描＋tools/draw-scrolls.py
 * 绘制参数互证，六张分别量、不假设一致）：
 * - classic 红杆：杆身卷草纹环带行 41..52 / 783..794，带上沿线 y=41、带下沿线 y=795；
 * - cloud 金杆：杆身环带（旧模环位）行 41..52 / 783..794，同 41 / 795
 *   （注：宝塔帽底线 y=23 色差虽最强，但作锚帽子不升反降、与用户「帽子再往上提」矛盾，不取）；
 * - blue/pear/bamboo 原三杆：杆身雕环行 41..52 / 783..794（轮廓外扩 [11,76]），同 41 / 795；
 * - funeral 黑杆：祥云纹带行 34..103 / 732..801，带上沿亮线 y=34、带下沿亮线 y=802。
 * 基准画布（纸高 294）派生值：五杆 k=294/754≈0.3899、上下各探出 41k≈15.99；
 * funeral k=294/768≈0.3828、上下各探出 34k≈13.02。均 ＜上留白 48／下留白 30，不顶屏幕边。
 * 杆缘贴纸缘零间隙不变：图按透明带左移 −SHAFT_X·k、槽位宽＝SHAFT_W·k；
 * PAPER_H 与列几何一概不动。
 */
const SCROLL_GEOM = {
  IMG_W: 88, IMG_H: 836,
  CAP_TOP: 23, CAP_BOT: 23,
  SHAFT_TOP: 23, SHAFT_H: 790,
  SHAFT_X: 15, SHAFT_W: 58,
  /** AV 分界线锚点（图内 y 坐标：上分界线／下分界线，逐主题量测如上注释） */
  LINES: {
    classic: { top: 41, bottom: 795 },
    blue: { top: 41, bottom: 795 },
    pear: { top: 41, bottom: 795 },
    bamboo: { top: 41, bottom: 795 },
    cloud: { top: 41, bottom: 795 },
    funeral: { top: 34, bottom: 802 },
  },
  LINES_DEFAULT: { top: 41, bottom: 795 },
};
/**
 * 由实际纸面高（设备 px）与主题算卷轴定位：整图等比缩放（同 k），
 * 该主题的上下分界横线恰对齐纸面上下边（AV 改锚）；themeId 缺省/未知走 LINES_DEFAULT。
 */
function scrollLayout(paperHPx, themeId) {
  const g = SCROLL_GEOM;
  const h = Number(paperHPx) > 0 ? Number(paperHPx) : SPEC.PAPER_H;
  const lines = g.LINES[themeId] || g.LINES_DEFAULT;
  const k = h / (lines.bottom - lines.top);
  return {
    imgW: round2(g.IMG_W * k),                       // 整图显示宽
    imgH: round2(g.IMG_H * k),                       // 整图显示高 = 纸高 + 上下探出
    top: round2(-lines.top * k),                     // 图顶偏移（负：上分界线落纸顶）
    capTopPx: round2(lines.top * k),                 // 纸顶之上探出量（帽＋分界线以上图段）
    capBotPx: round2((g.IMG_H - lines.bottom) * k), // 纸底之下探出量
    slotW: round2(g.SHAFT_W * k),                    // 槽位宽 = 杆身实绘宽
    left: round2(-g.SHAFT_X * k),                    // 图左偏移：透明带移出槽外，杆身实绘缘贴纸缘
    lineTop: lines.top, lineBottom: lines.bottom,    // 本次所用锚点（断言/调试用）
  };
}

const FONTS = [
  { id: 'lxgw', name: '霞鹜文楷', family: 'LxgwWenKai', calibration: 1.00, file: 'lxgw-wenkai.woff2', cloudFile: 'lxgw-wenkai.ttf' },
  { id: 'mashanzheng', name: '马善政毛笔体', family: 'MaShanZheng', calibration: 1.05, file: 'mashanzheng.woff2', cloudFile: 'mashanzheng.ttf' },
  { id: 'longcang', name: '龙藏体', family: 'LongCang', calibration: 1.20, file: 'longcang.woff2', cloudFile: 'longcang.ttf' },
];
const SONGTI_STACK = '"Songti SC","STSong","Noto Serif CJK SC",SimSun,serif';
const KAITI_STACK = '"KaiTi","STKaiti","楷体"';

function fontById(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }
/** 经校准后的实际字号（仅 layout 内部防叠间距/缩字计算用，不得直接作渲染字号） */
function calibratedSize(basePx, fontId) {
  return round2(basePx * fontById(fontId).calibration);
}
/**
 * 渲染字号（2026-10-22 任务AB 第 1 项，用户定版：姓名/金额不得大于「贺礼/奠仪」）：
 * 校准只保留在 layoutName/layoutAmount 内部（防叠间距与缩字按校准后尺寸算），
 * 输出到 CSS 的字号一律封顶中段字号 MID_FONT(22)——三款字体、以及字体加载失败
 * 回退宋体时，姓名/金额都恒 ≤22、默认字数下恒 =22，绝不再比中段词大。
 */
function renderFontSize(nominalPx, fontId) {
  return Math.min(calibratedSize(nominalPx, fontId), SPEC.MID_FONT);
}
/**
 * 所选字体的 font-family 栈：所选字体 → 系统楷体 → 宋体栈。
 * 缺字靠这条回退链逐字回退，保证不出方框（真机回退表现待联调验证）。
 */
function selectedStack(fontId) {
  return `"${fontById(fontId).family}",${KAITI_STACK},${SONGTI_STACK}`;
}

/**
 * 中段文字分工（2026-10-22 任务AA 改定）：
 * - 中段词只剩两个：白事→奠仪、其余全部→贺礼（不再有「礼金」）；
 * - 贺礼 / 奠仪：固定印刷宋体（fontRole='songti'）
 * - 姓名 / 金额：跟随所选字体
 */
function fontRoleForMid() {
  return 'songti';
}

/** 标签 → 中段文字（任务AA 定版：白事=奠仪，其余一律=贺礼） */
const MID_BY_TAG = {
  jiehun: '贺礼', shengzi: '贺礼', shengri: '贺礼', shengxue: '贺礼', qiaoqian: '贺礼', dashou: '贺礼',
  baishi: '奠仪', yasui: '贺礼', tanwang: '贺礼', qita: '贺礼',
};
function midTextForTag(tagId) { return MID_BY_TAG[tagId] || '贺礼'; }

/**
 * 整本白事判定（AT批，用户 2026-10-27 亲报的严重问题定版）：
 * 白事场合出现「贺礼」是礼仪大忌、零容忍——判定不能只认标签，
 * 礼薄标题写了葬礼/殡葬/白事等词同样算白事（用户建薄时常只改名不改标签）。
 * 关键词为标题子串匹配：宁可误判白事（用户改名即可），不可白事显贺礼。
 */
const FUNERAL_KEYWORDS = ['葬礼', '殡葬', '白事', '丧事', '丧礼', '追悼'];
function isFuneralBook({ tagId, title } = {}) {
  if (tagId === 'baishi') return true;
  const t = String(title || '');
  return FUNERAL_KEYWORDS.some((k) => t.includes(k));
}

/**
 * 整本中段词（AT批）：标签、标题、所选样式任一指向白事 → 全列「奠仪」；
 * 红线：isFuneralBook 为真时中段词不随样式切换离开奠仪（样式只能换皮不能换词）。
 * 都不指向白事时整本「贺礼」（逐列记录级差异仍走 midTextForTag 缺省）。
 */
function resolveBookMidText({ tagId, title, styleId } = {}) {
  return (isFuneralBook({ tagId, title }) || styleId === 'funeral') ? '奠仪' : '贺礼';
}

/**
 * 主题表（6 种样式定版；颜色取自定版图 33–38 实测值）。
 * 纹路覆盖三处：留白（marginTile）+ 纸面背景（paperTile）+ 卷轴（scrollImg 按主题换色）。
 * 白事（funeral）：全页无红色——plus/高亮/中段/列线均为黑灰系，noRed=true 供测试与页面断言。
 * 2026-10-22 任务AB 第 3/9 项（用户真机反馈"字太淡"）：姓名/金额墨色加深一档
 * （贺礼类统一 #262019 深褐黑；白事 #2E3237），中段词颜色逐样式加深一档
 * （深红 #9E2A22 / 深蓝 #3D6A8F / 深金 #8A6520 / 深竹青 #33684C / 白事深灰 #15181B，仍无红）。
 * AU批（2026-10-27，用户给参考图拍板搭配）：classic/cloud/funeral 三主题的卷轴杆图重绘——
 * 只取参考图的颜色/纹路/帽型（classic=深红小圆柱帽＋朱红卷草纹杆、cloud=金宝塔帽＋米金淡祥云杆、
 * funeral=炭黑圆球帽＋浅灰祥云纹带杆），主题名称/纸面/色值全不动，几何仍 SCROLL_GEOM 同模
 * （88×836、帽 23＋杆身 790＋帽 23、杆身实绘 [15,72]）；重绘脚本 tools/draw-scrolls.py。
 */
const THEMES = {
  classic: {
    id: 'classic', name: '传统经典', kind: 'festive',
    lineColor: '#B8322A', frameColor: '#B8322A', paperBg: '#FFF8F2', marginBg: '#F9E9DC',
    midColor: '#9E2A22', inkColor: '#262019', plusBg: '#C0453C',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-classic.png',
    marginTile: TILES.CLASSIC.margin, paperTile: TILES.CLASSIC.paper, noRed: false,
  },
  blue: {
    id: 'blue', name: '淡蓝水波纹', kind: 'festive',
    lineColor: '#5B8DB0', frameColor: '#5B8DB0', paperBg: '#F4F9FC', marginBg: '#D9E7F1',
    midColor: '#3D6A8F', inkColor: '#262019', plusBg: '#7FA8C9',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-blue.png',
    marginTile: TILES.BLUE.margin, paperTile: TILES.BLUE.paper, noRed: false,
  },
  pear: {
    id: 'pear', name: '梨花白', kind: 'festive',
    // 定版图 35：纸面为红线纸（列线/中段红），留白与卷轴为淡金梨花
    lineColor: '#B8322A', frameColor: '#B8322A', paperBg: '#FFF8F2', marginBg: '#FBF6EC',
    midColor: '#9E2A22', inkColor: '#262019', plusBg: '#C9A24B',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-pear.png',
    marginTile: TILES.PEAR.margin, paperTile: TILES.PEAR.paper, noRed: false,
  },
  cloud: {
    id: 'cloud', name: '祥云金', kind: 'festive',
    lineColor: '#A67C2E', frameColor: '#A67C2E', paperBg: '#FDF8EC', marginBg: '#F5EAD0',
    midColor: '#8A6520', inkColor: '#262019', plusBg: '#C39A3B',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-cloud.png',
    marginTile: TILES.CLOUD.margin, paperTile: TILES.CLOUD.paper, noRed: false,
  },
  bamboo: {
    id: 'bamboo', name: '竹青', kind: 'festive',
    lineColor: '#3E7C5B', frameColor: '#3E7C5B', paperBg: '#F2F8F3', marginBg: '#DCEDE1',
    midColor: '#33684C', inkColor: '#262019', plusBg: '#6FA585',
    highlightBorder: '#C9A24B', highlightBg: 'rgba(201,162,75,0.10)',
    scrollImg: '/assets/scrolls/scroll-bamboo.png',
    marginTile: TILES.BAMBOO.margin, paperTile: TILES.BAMBOO.paper, noRed: false,
  },
  funeral: {
    id: 'funeral', name: '白事', kind: 'funeral',
    lineColor: '#3B4046', frameColor: '#3B4046', paperBg: '#FFFFFF', marginBg: '#F2F2F2',
    midColor: '#15181B', inkColor: '#2E3237', plusBg: '#3B4046',
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

/**
 * 收礼页样式判定（AT批扩展版）：整本白事判定（标签或标题命中）→ 默认白事样式；
 * 否则同 resolveReceiveTheme。旧签名保留兼容（既有测试与调用不迁移）。
 */
function resolveReceiveTheme2({ tagId, title } = {}, selectedStyleId) {
  return isFuneralBook({ tagId, title }) ? 'funeral'
    : (THEMES[selectedStyleId] ? selectedStyleId : 'classic');
}

/** 姓名逐字布局（2026-10-22 晚用户定版，覆盖旧字位制）：
 * 第一个字位置不动（区顶），最后一个字下移到底——其墨迹下缘距「贺礼」首字
 * 墨迹上缘恰 GAP(4)px（区高 NAME_H 已经模型实测校准，见 COL_INNER_H 注释）；中间各字在首末之间均匀分布。字号默认与中段同大 NAME_FONT(22)；
 * **坚决不许叠字**（用户定版语）：放不下时宁可缩小字号——f = min(22, 区高/字数)，
 * 此时字距恰等于字号、字形盒相接不重叠。锚点与字号无关：首字恒区顶、末字恒区底。 */
function layoutName(name, cal = 1) {
  const chars = Array.from(String(name || ''));
  const n = chars.length;
  if (n === 0) return { chars: [], scale: 1, fontSize: SPEC.NAME_FONT, pitch: SPEC.NAME_PITCH };
  // 不叠字按**校准后实际字号**算：fNom×cal ≤ 区高/字数；字距=(区高−实际字号)/(n−1) ≥ 实际字号
  const fontSize = n >= 2 ? Math.min(SPEC.NAME_FONT, round2(SPEC.NAME_H / (n * cal))) : SPEC.NAME_FONT;
  const eff = fontSize * cal;
  const pitch = n >= 2 ? (SPEC.NAME_H - eff) / (n - 1) : 0;
  return {
    scale: round2(fontSize / SPEC.NAME_FONT), fontSize, pitch: round2(pitch),
    chars: chars.map((ch, i) => ({ ch, top: n === 1 ? 0 : round2(i * pitch) })),
  };
}

/** 金额逐字布局：**底锚定到字形盒下缘**（2026-10-22 任务AA 再定版，覆盖任务Z 的字位锚）——
 * 不论几字，末字「整」的字形盒下缘与金额区下缘齐平（top + fontSize = AMT_H），
 * 其余字按字位距逐字向上回推；字少时起始位随之下移（姓名是顶锚定，两者不同，勿混）。
 * ≤4 字字位距 24；超 4 字按比例压缩（字位距 = 96/字数、字号等比），下缘仍齐平。
 * 【任务Z 版为何真机没贴底】旧版按"末字 top + pitch = 区高"锚定，字形盒下缘还差
 * pitch − fontSize = 2px；且当时列内三段是流式堆叠、金额区并未落在列底（见 book.wxss
 * 任务AA 的绝对定位三段），双重偏差叠加成真机上「整」字下方大片空白。 */
/** 金额逐字布局（2026-10-22 晚用户定版，覆盖旧字位制）：
 * 末字「整」位置不变（字形盒下缘与区下缘齐平，区底锚定同任务AA）；
 * 第一个字上移到顶——其墨迹上缘距「贺礼」末字墨迹下缘恰 GAP(4)px（区高 AMT_H 已按此反推，见 COL_INNER_H 注释）；
 * 中间各字在首末之间均匀分布。字号默认与中段同大 AMT_FONT(22)；
 * **坚决不许叠字**：放不下时宁可缩小字号——f = min(22, 区高/字数)（算法同 layoutName）。 */
function layoutAmount(amountFen, cal = 1) {
  const text = amountToChineseUpper(amountFen);
  const chars = Array.from(text);
  const n = chars.length;
  const fontSize = n >= 2 ? Math.min(SPEC.AMT_FONT, round2(SPEC.AMT_H / (n * cal))) : SPEC.AMT_FONT;
  const eff = fontSize * cal;
  const pitch = n >= 2 ? (SPEC.AMT_H - eff) / (n - 1) : 0;
  return {
    text, scale: round2(fontSize / SPEC.AMT_FONT), fontSize, pitch: round2(pitch),
    chars: chars.map((ch, i) => ({ ch, top: n === 1 ? round2(SPEC.AMT_H - eff) : round2(i * pitch) })),
  };
}

/**
 * 横置礼单取数顺序（任务AA 定版）：按**记账先后（创建升序）**排，第一笔在最左列。
 * 列表接口（core listRecords/listGifts）统一 createdAt 倒序（最新在上，给竖排列表用），
 * 书页必须在这里翻正。Array.prototype.sort 为稳定排序：createdAt 同毫秒并列时，
 * 倒序列表里并列项保持着创建先后，升序稳定排序后并列项相对序不变，结果仍是创建序。
 */
function orderForBook(records) {
  return [...(Array.isArray(records) ? records : [])]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * 构建列模型。
 * records：账本顺序，**records[0] 放纸面最左列**，后续记录依次向右排
 * （2026-10-22 用户定版，覆盖旧定版的右起排法——旧口径为 records[0] 在最右、
 * 空列在左；新口径第一条最左、空列补在最后一条记录右侧，三种本子一致）。
 * 每条 {id, name, amountFen, tagId}
 * 返回 display 顺序（左→右）的列数组：records 正序 + 右侧空格子补满。
 * 格子印满整幅纸面：总列数 = max(12, 记录数)，空列只有线框、内容为空；
 * 超出一屏（12 列）的记录靠横向滚动查看，不压缩列宽。
 */
function buildColumns(records, opts = {}) {
  const list = Array.isArray(records) ? records : [];
  const totalGrid = Math.max(SPEC.COLS_PER_SCREEN, list.length);
  const emptyCount = totalGrid - list.length;
  const fontId = opts.fontId || 'lxgw';
  const cols = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const midText = opts.midText || midTextForTag(r.tagId);
    const cal = fontById(fontId).calibration;
    const name = layoutName(r.name, cal);
    const amt = layoutAmount(r.amountFen, cal);
    cols.push({
      key: `rec-${r.id}`,
      empty: false,
      recordId: r.id,
      name: r.name,
      nameChars: name.chars, nameFontSize: renderFontSize(name.fontSize, fontId), nameScale: name.scale,
      midText,
      midRole: fontRoleForMid(midText),
      // 中段在**整列绝对正中**（任务AA 定版）：字在本区内先居中（墨迹高
      // =(字数-1)×字位距 + 字号，上下留白均分），区本身再由 book.wxss 以
      // top:50%+translateY(-50%) 钉在列高中心——两级居中叠加，墨迹中心＝列中心。
      // （任务Z 只做了区内居中、区还在流式排布的上半部，真机看着偏中上。）
      midChars: (() => {
        const arr = Array.from(midText);
        const ink = arr.length ? (arr.length - 1) * SPEC.MID_PITCH + SPEC.MID_FONT : 0;
        const top0 = Math.max(0, (SPEC.MID_H - ink) / 2);
        return arr.map((ch, i) => ({ ch, top: round2(top0 + i * SPEC.MID_PITCH) }));
      })(),
      // 送礼页奠仪列：中段字黑色（39 号定版）；其余列用主题中段色（页面层决定）
      midBlack: midText === '奠仪',
      amountText: amt.text,
      amountChars: amt.chars, amountFontSize: renderFontSize(amt.fontSize, fontId), amountScale: amt.scale,
      amountFen: r.amountFen,
    });
  }
  // 空格子补在最后一条记录右侧（第一条最左口径）：一屏先铺满，格子印满整幅纸面
  for (let i = 0; i < emptyCount; i++) {
    cols.push({ key: `empty-${i}`, empty: true, recordId: null });
  }
  return { columns: cols, emptyCount, totalGrid, recordCount: list.length };
}

/**
 * 【已停用】滚动窗口化：曾按可视范围 ±buffer 列渲染、占位 view 撑几何。
 * 2026-10-22 起页面改为全量确定性渲染，不再调用本函数（保留仅为兼容旧测试）：
 * 窗口化 + 初始 scrollLeft 定位最右端的做法存在竞态——scroll-view 初始布局时
 * scroll 事件时序不确定，窗口随之漂移，真机表现为同一本子多次打开少列/从中间开始。
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
  backButton: '切换回竖置样式', // 定版图30文案（2026-10-22 曾按真机反馈改名「返回竖屏」，同日用户确认手机自动旋转正常后决定回退，恢复定版原样）
};

module.exports = {
  USE_ENV_SAFE_AREA, SPEC, COL_INNER_H, scaledSpec, round2,
  SCROLL_GEOM, scrollLayout,
  FONTS, fontById, calibratedSize, renderFontSize, selectedStack, SONGTI_STACK, KAITI_STACK,
  fontRoleForMid, MID_BY_TAG, midTextForTag,
  FUNERAL_KEYWORDS, isFuneralBook, resolveBookMidText,
  THEMES, THEME_LIST, themeById, resolveReceiveTheme, resolveReceiveTheme2,
  layoutName, layoutAmount, orderForBook, buildColumns, windowRange,
  createOrientationMachine, createSelectionStore, permissionsFor,
  detailAmountText, ROTATE_COPY,
};
