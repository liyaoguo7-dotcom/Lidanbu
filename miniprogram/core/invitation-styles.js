/**
* 礼单簿 · 电子请柬风格常量（阶段4）
*
* 4 种风格，图案全部原创（版权红线见 docs/references/invitation/README.md：
* 只借鉴版式/配色方向，不复制任何现成请柬的具体图案、文字、品牌元素）。
* 本文件是唯一口径来源：小程序页面渲染与 docs/wireframes/invitation/
* 的预览图都按这里的配色/边框/字体栈走，改风格先改这里。
*
* 配色数值已对齐用户看过的定版效果图
* （docs/wireframes/invitation/01-新中式国潮.png 等 I2 版，口径表在该目录 README）：
* 主色/底色/辅色/文字色逐项取自口径表。个别字段落位说明：
* - 国潮是"红纸金字"：深红 #7E1B1B 落在 paper/bg（整幅红纸），
* primary（印记/角花/选中色）取金 #C9A24B，亮金 #E9C767 作 accent 与次要文字；
* - 原木 sub 取深木 #A87F4E 作次级色调；法式 bg 取墨绿外底 #2E4038。
* 字体口径：4 种风格全宋体栈；国潮定版图中姓名另用马善政毛笔体（OFL），
* 页面姓名随卡片字体栈渲染，不另引字体。
*
* 每种风格字段：
* id/name/tagline 标识与展示名
* colors bg 纸外底 / paper 纸面 / ink 正文 / sub 次要文字 /
* primary 主色 / accent 辅色 / line 分隔线
* borderCss 纸面边框（拼好的 CSS，页面直接套）
* deco 装饰母题名（原创几何纹样，页面按 id 分支渲染）
* fontStack 标题字体栈（风格规范：不引入外部字体）
* sealText 印记文字（风格小印/点缀字样）
*/

const SONGTI = '"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif';
const KAITI = '"Kaiti SC","STKaiti","KaiTi","楷体",serif';
const SANS = '-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

const STYLES = [
{
id: 'guochao',
name: '新中式国潮',
tagline: '深红描金 · 喜庆大气',
colors: {
bg: '#7E1B1B', paper: '#7E1B1B', ink: '#F3E3BC', sub: '#E9C767',
primary: '#C9A24B', accent: '#E9C767', line: '#C9A24B',
},
borderCss: '3px double #C9A24B',
deco: 'corner-diamond', // 原创：双线方角 + 旋转菱形点
fontStack: SONGTI,
sealText: '囍',
},
{
id: 'cream',
name: '现代极简奶油',
tagline: '奶油留白 · 干净高级',
colors: {
bg: '#F1EADF', paper: '#FAF5EC', ink: '#54402A', sub: '#8A6D4F',
primary: '#B99B6B', accent: '#B99B6B', line: '#D8C7AC',
},
borderCss: '1px solid #D8C7AC',
deco: 'seal-dot', // 原创：细金线 + 圆点印记
fontStack: SONGTI,
sealText: '礼',
},
{
id: 'french',
name: '法式复古',
tagline: '墨绿描金 · 拱门花影',
colors: {
bg: '#2E4038', paper: '#F7F1E3', ink: '#33463B', sub: '#68766B',
primary: '#2E4038', accent: '#B08D46', line: '#B08D46',
},
borderCss: '2px solid #B08D46',
deco: 'arch', // 原创：对称拱形线框 + 简笔枝叶
fontStack: SONGTI,
sealText: '邀',
},
{
id: 'wood',
name: '原木风',
tagline: '原木暖调 · 自然质朴',
colors: {
bg: '#EAE0CC', paper: '#F5EEE0', ink: '#5D4630', sub: '#A87F4E',
primary: '#C29A67', accent: '#A87F4E', line: '#C29A67',
},
borderCss: '2px solid #C29A67',
deco: 'rings', // 原创：年轮同心弧线 + 细枝
fontStack: SONGTI,
sealText: '木',
},
];

function getStyle(styleId) {
return STYLES.find((s) => s.id === styleId) || STYLES[0];
}

module.exports = { STYLES, getStyle, SONGTI, KAITI, SANS};
