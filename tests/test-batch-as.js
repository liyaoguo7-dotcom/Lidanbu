/**
 * AS批静态断言：OCR 质量修复接线＋核对页样式＋两处 UI 返工。
 * （node 原生 assert，run.js 尾部 require；行为断言在 test-batch-as-behavior.js）
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

/* AS-1~AS-4 解析器/质量门/繁简（服务端 tencent-ocr.js） */
assert.ok(has('cloudfunctions/api/zh-t2s.js'), 'AS-4 繁简对照表应独立成模块');
const ocr = rd('cloudfunctions/api/tencent-ocr.js');
assert.ok(ocr.includes("require('./zh-t2s')"), 'AS-4 解析器应接入繁简模块');
assert.ok(ocr.includes('parseChineseAmount'), 'AS-1 应有中文金额换算');
assert.ok(ocr.includes('assessQuality'), 'AS-3 应有质量评估函数');
assert.ok(ocr.includes('QUALITY_MIN_CONFIDENCE'), 'AS-3 质量阈值应为具名常量');
assert.ok(ocr.includes('parseVertical') && ocr.includes('detectVertical'), 'AS-2 应有竖排判定与竖排解析');

/* AS-8 识别留痕：适配器挂痕、core 落 importJobs.ocrRaw、admin 统计跳过 */
assert.ok(ocr.includes('ocrTrace') && ocr.includes('buildTraceCall'), 'AS-8 适配器应构造留痕');
assert.ok(ocr.includes('TRACE_MAX_CHARS'), 'AS-8 留痕体积上限应为具名常量');
const coreImport = rd('core/import.js');
assert.ok(coreImport.includes('ocrRaw') && coreImport.includes("status: 'recognized'"), 'AS-8 core 应把留痕落 importJobs');
assert.ok(rd('core/ocr-adapter.js').includes('list.ocrTrace'), 'AS-8 归一化层应透传留痕');
assert.ok(rd('core/admin.js').includes("status === 'recognized'"), 'AS-8 用量统计应跳过留痕文档');

/* AS-5 核对页样式：行高 46、连续白底、收礼无日期、送礼五字段齐在 */
const revWxss = rd('miniprogram/pages/import/import-review.wxss');
assert.ok(revWxss.includes('min-height: 46px'), 'AS-5 核对页表单行应压到 46px');
assert.ok(/\.item-card\s*\{[^}]*margin: 0 12px/.test(revWxss), 'AS-5 记录卡应取消上下间距连成白底');
assert.ok(revWxss.includes('item-first') && revWxss.includes('item-last'), 'AS-5 首尾卡圆角口径');
const revWxml = rd('miniprogram/pages/import/import-review.wxml');
assert.ok(revWxml.includes(`wx:if="{{kind !== 'receive'}}"`), 'AS-5 日期行应对收礼隐藏');
for (const label of ['姓名', '金额', '场合', '日期', '备注', '类型']) {
  assert.ok(revWxml.includes(`>${label}<`), `AS-5 字段「${label}」应保留`);
}
assert.ok(revWxml.includes('原图对照'), 'AS-5 顶部原图对照卡保留');

/* AS-6 顶部条：胶囊实测定位＋App 周期 tick＋无 storage 标记 */
const tbJs = rd('miniprogram/components/top-banner/top-banner.js');
assert.ok(tbJs.includes('getMenuButtonBoundingClientRect'), 'AS-6 顶条定位应读胶囊实测位置');
assert.ok(tbJs.includes('topBannerShownTick') && tbJs.includes('tryShow'), 'AS-6 应按 App 周期 tick 弹一次');
assert.ok(!tbJs.includes('StorageSync'), 'AS-6 顶条不得读写任何 storage 标记');
assert.ok(!tbJs.includes('52px'), 'AS-6 不得再用 52px 估值定位');
const tbWxss = rd('miniprogram/components/top-banner/top-banner.wxss');
assert.ok(tbWxss.includes('left: 12px'), 'AS-6 宽度口径已由 BA批改版：左缘固定 12px＋右缘按胶囊实测让开');
const appJs = rd('miniprogram/app.js');
assert.ok(appJs.includes('appShowTick += 1'), 'AS-6 App.onShow 应递增前台化周期');
assert.ok(appJs.includes('topBannerShownTick'), 'AS-6 周期已弹标记只存 globalData 内存');
const idxJs = rd('miniprogram/pages/index/index.js');
assert.ok(idxJs.includes("selectComponent('#topBanner')"), 'AS-6 首页 onShow 应驱动顶条 tryShow');
assert.ok(rd('miniprogram/pages/index/index.wxml').includes('id="topBanner"'), 'AS-6 首页顶条应带 id');

/* AS-7 我的页引导：红条白字单行＋教程示意精修＋无持久标记、进页即显示 */
const mineJs = rd('miniprogram/pages/mine/mine.js');
assert.ok(!mineJs.includes("setStorageSync('addMpGuideDone'"), 'AS-7 不得再写 addMpGuideDone');
assert.ok(!mineJs.includes("getStorageSync('addMpGuideDone'"), 'AS-7 不得再读 addMpGuideDone');
assert.ok(mineJs.includes('addMpGuideShow: true'), 'AS-7 进我的页即显示红条');
assert.ok(mineJs.includes('_mpGuideClosed'), 'AS-7 关闭只走页面内状态');
const mineWxml = rd('miniprogram/pages/mine/mine.wxml');
assert.ok(mineWxml.includes('addmp-panel'), 'AS-7 教程示意已由 BA批改版：深藏青「我的小程序」面板卡');
assert.ok(mineWxml.includes('addmp-grid-icon'), 'AS-7 教程示意已由 BA批改版：第 2 步橙色四点图标');
const mineWxss = rd('miniprogram/pages/mine/mine.wxss');
assert.ok(/\.addmp-bar\s*\{[^}]*background: #F0575A/.test(mineWxss), 'AS-7 红条底色主红 #F0575A');
assert.ok(/\.addmp-bar\s*\{[^}]*color: #fff/.test(mineWxss), 'AS-7 红条文字白色');
assert.ok(/\.addmp-text\s*\{[^}]*white-space: nowrap/.test(mineWxss), 'AS-7 红条文案单行不折行');

console.log('✓ AS批·接线静态断言全过');
