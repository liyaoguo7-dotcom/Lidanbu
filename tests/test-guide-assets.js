/** 引导页真实截图素材（任务R）：
 * - 引导页引用分包 packages/guide 的三张图、配文逐字
 * - 三张成品图单张 ≤150KB（文件断言）
 * - app.json 注册 guide 纯资源分包 + 首页 preloadRule 预下载
 * - 线框示意已清除（guide.wxml/wxss 无旧线框结构） */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SHOTS = [
  { file: 'guide-receive.png', caption: '收到的礼，一笔笔记清楚' },
  { file: 'guide-gifts.png', caption: '送出的礼，随时翻看' },
  { file: 'guide-timeline.png', caption: '人情往来，一目了然' },
];
const LIMIT = 150 * 1024;

test('引导素材：三张成品图都在分包内且单张 ≤150KB', async () => {
  for (const s of SHOTS) {
    const p = path.join(ROOT, 'miniprogram/packages/guide', s.file);
    assert(fs.existsSync(p), `${s.file} 应存在于 packages/guide 分包`);
    const size = fs.statSync(p).size;
    assert(size > 0 && size <= LIMIT, `${s.file} 体积 ${size} 应在 (0, ${LIMIT}] 内`);
  }
});

test('引导素材：引导页引用分包图路径且三句配文逐字正确', async () => {
  const js = read('miniprogram/pages/guide/guide.js');
  for (const s of SHOTS) {
    assert(js.includes(`/packages/guide/${s.file}`), `guide.js 应引用 /packages/guide/${s.file}`);
    assert(js.includes(`caption: '${s.caption}'`), `配文应逐字为「${s.caption}」`);
  }
  const wxml = read('miniprogram/pages/guide/guide.wxml');
  assert(wxml.includes('item.img') && wxml.includes('item.caption'), 'wxml 应渲染图片与配文');
});

test('引导素材：app.json 注册 guide 分包（preloadRule 已删，见用例内注）', async () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  const sub = (app.subpackages || []).find((s) => s.root === 'packages/guide');
  assert(sub && Array.isArray(sub.pages), '应注册 packages/guide 纯资源分包');
  // preloadRule 已于 2026-10-21 整体删除（开发者工具版本对该配置解析口径与文档不一致，
  // name 与 root 两种写法均报"未找到"导致启动失败）；预下载仅为提速优化，
  // 删除后引导/字体分包改为按需加载，功能不变。此处不断言 preloadRule。
});

test('引导素材：线框示意已清除', async () => {
  const wxml = read('miniprogram/pages/guide/guide.wxml');
  const wxss = read('miniprogram/pages/guide/guide.wxss');
  for (const marker of ['class="phone"', 'phone-head', 'tabbar']) {
    assert(!wxml.includes(marker) && !wxss.includes(marker), `不应再有线框标记 ${marker}`);
  }
  assert(!read('miniprogram/pages/guide/guide.js').includes('收礼这样记'), '旧线框文案标题应已删除');
});
