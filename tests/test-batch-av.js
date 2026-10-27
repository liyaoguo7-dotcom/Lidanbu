/**
 * AV批静态断言：卷轴改锚接线（分界线锚点表＋scrollLayout 主题参数＋页面三处重算）。
 * 行为/数值断言在 test-batch-av-behavior.js；这里只查源码结构，防接线回退。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const core = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape/landscape-core.js'), 'utf8');
const bc = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/landscape/book-common.js'), 'utf8');

/* 核心：锚点表与主题参数 */
assert.ok(core.includes('LINES'), 'AV landscape-core 应有分界线锚点表 LINES');
assert.ok(core.includes('LINES_DEFAULT'), 'AV 应有缺省锚 LINES_DEFAULT（无主题调用兼容）');
assert.ok(/function scrollLayout\(paperHPx, themeId\)/.test(core), 'AV scrollLayout 应带 themeId 参数');
assert.ok(core.includes('lines.bottom - lines.top'), 'AV 缩放系数应由分界跨度算（不再是 SHAFT_H）');
assert.ok(!/const k = h \/ g\.SHAFT_H/.test(core), 'AV 不得再用杆身高算卷轴缩放（旧锚已废）');

/* 页面接线：三处主题落定后重算＋方向计算带主题 */
assert.ok(bc.includes('LC.scrollLayout(paperHPx, this.data.theme'), 'AV _applyOrientation 应按当前主题算卷轴定位');
assert.ok(bc.includes('_syncScrollBox()'), 'AV book-common 应有卷轴定位重算入口');
assert.ok((bc.match(/this\._syncScrollBox\(\)/g) || []).length >= 3,
  'AV 主题落定三处（_reloadReceive/_reloadGift/_refreshTheme）都应重算卷轴定位');
assert.ok(bc.includes('this._paperHPx = paperHPx'), 'AV 应存下实际纸高供主题切换时重算');

console.log('test-batch-av: ok');
