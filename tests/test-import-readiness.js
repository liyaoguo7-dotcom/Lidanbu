/** 可导入性常驻检查（2026-10-21 用户真机导入时暴露的系统性缺口，立为常驻门禁）：
 * 背景：project.config.json 曾缺 miniprogramRoot 导致开发者工具"在项目根目录
 * 未找到 app.json"；老板平台全部页面与"我的"若干页面的相对 require 层级写错
 * 一层，真环境加载即失败。此前测试全是逻辑层，从未验过"项目能否被导入运行"。
 * 本文件锁死这类问题，每次提交自动检查：
 * 1) project.config.json 的 miniprogramRoot 指向含 app.json 的目录；
 * 2) app.json 注册的全部页面（含分包）必需文件 .js/.wxml 齐全
 *    （.json/.wxss 为可选，不查）；
 * 3) miniprogram 内全部相对 require 可解析到真实文件；
 * 4) 全部 json 的 usingComponents 指向真实组件；
 * 5) tabBar 图标文件存在；wxml 里绝对路径的图片资源存在。 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const REPO = path.join(__dirname, '..');
const ROOT = path.join(REPO, 'miniprogram');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

test('可导入性：project.config 的 miniprogramRoot 指向含 app.json 的目录', () => {
  const pc = JSON.parse(fs.readFileSync(path.join(REPO, 'project.config.json'), 'utf8'));
  assert(pc.miniprogramRoot, 'project.config.json 必须声明 miniprogramRoot');
  const dir = path.join(REPO, pc.miniprogramRoot);
  assert(fs.existsSync(path.join(dir, 'app.json')), 'miniprogramRoot 目录下必须有 app.json');
  assert(fs.existsSync(path.join(dir, 'app.js')), 'miniprogramRoot 目录下必须有 app.js');
});

test('可部署性：project.config 声明 cloudfunctionRoot 且云函数目录齐备', () => {
  const pc = JSON.parse(fs.readFileSync(path.join(REPO, 'project.config.json'), 'utf8'));
  assert(pc.cloudfunctionRoot, 'project.config.json 必须声明 cloudfunctionRoot（缺了开发者工具不显示「上传并部署」）');
  const cfRoot = path.join(REPO, pc.cloudfunctionRoot);
  for (const fn of ['api', 'init']) {
    assert(fs.existsSync(path.join(cfRoot, fn, 'index.js')), `云函数 ${fn} 缺 index.js`);
    assert(fs.existsSync(path.join(cfRoot, fn, 'package.json')), `云函数 ${fn} 缺 package.json`);
  }
});

test('可部署性：init 云函数 set 数据不得带 _id（云端 -501007 回归）', () => {
  const src = fs.readFileSync(path.join(REPO, 'cloudfunctions/init/index.js'), 'utf8');
  assert(!/_id:\s*'singleton'/.test(src), "defaultConfig 不得含 _id:'singleton'（doc().set 的 data 带 _id 会被云数据库拒绝）");
});

test('可导入性：app.json 注册的全部页面（含分包）必需文件齐全', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const missing = [];
  const check = (p) => {
    for (const ext of ['.js', '.wxml']) {
      if (!fs.existsSync(path.join(ROOT, p + ext))) missing.push(p + ext);
    }
  };
  (app.pages || []).forEach(check);
  for (const sp of app.subpackages || app.subPackages || []) {
    (sp.pages || []).forEach((p) => check(path.join(sp.root, p)));
  }
  assert(missing.length === 0, '缺必需文件: ' + missing.join(', '));
});

test('可导入性：miniprogram 内全部相对 require 均可解析', () => {
  const bad = [];
  for (const f of walk(ROOT, '.js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const t = path.join(path.dirname(f), m[1]);
      if (!fs.existsSync(t) && !fs.existsSync(t + '.js') && !fs.existsSync(path.join(t, 'index.js'))) {
        bad.push(path.relative(REPO, f) + ' -> ' + m[1]);
      }
    }
  }
  assert(bad.length === 0, '无法解析的 require: ' + bad.join(' | '));
});

test('可导入性：任何 require 不得越出 miniprogram 根（真机打包只认根内文件）', () => {
  // 教训（2026-10-22）：admin 两页 require 了仓库根 core/，在仓库里能解析、
  // 进了小程序包就找不到模块、页面空白（老板平台 5/7/8/13/16/17 没内容的根因）。
  const bad = [];
  const rootAbs = path.resolve(ROOT);
  for (const f of walk(ROOT, '.js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const t = path.resolve(path.dirname(f), m[1]);
      if (!t.startsWith(rootAbs + path.sep)) {
        bad.push(path.relative(REPO, f) + ' -> ' + m[1]);
      }
    }
  }
  assert(bad.length === 0, '越出 miniprogram 根的 require: ' + bad.join(' | '));
});

test('可导入性：usingComponents 与 tabBar 图标指向真实文件', () => {
  const bad = [];
  for (const jf of walk(ROOT, '.json')) {
    let j;
    try { j = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (e) { bad.push('JSON 解析失败: ' + path.relative(REPO, jf)); continue; }
    for (const rel of Object.values(j.usingComponents || {})) {
      if (String(rel).startsWith('plugin://')) continue;
      const base = rel.startsWith('/') ? path.join(ROOT, rel.slice(1)) : path.join(path.dirname(jf), rel);
      if (!fs.existsSync(base + '.js')) bad.push(path.relative(REPO, jf) + ' 组件 js 不存在: ' + rel);
      // 组件必须有 .json 且 component:true，否则真工具报"路径下未找到组件"（2026-10-21 真机导入实测）
      if (!fs.existsSync(base + '.json')) { bad.push(path.relative(REPO, jf) + ' 组件缺 .json 定义: ' + rel); continue; }
      try {
        const cj = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
        if (cj.component !== true) bad.push(path.relative(REPO, jf) + ' 组件 .json 未声明 component:true: ' + rel);
      } catch (e) { bad.push(path.relative(REPO, jf) + ' 组件 .json 解析失败: ' + rel); }
    }
  }
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  for (const item of (app.tabBar && app.tabBar.list) || []) {
    for (const k of ['iconPath', 'selectedIconPath']) {
      if (item[k] && !fs.existsSync(path.join(ROOT, item[k]))) bad.push('tabBar 图标不存在: ' + item[k]);
    }
  }
  assert(bad.length === 0, bad.join(' | '));
});

test('可导入性：wxml 中绝对路径图片资源存在', () => {
  const bad = [];
  for (const f of walk(ROOT, '.wxml')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/src="(\/[^"]+)"/g)) {
      if (!fs.existsSync(path.join(ROOT, m[1].slice(1)))) bad.push(path.relative(REPO, f) + ' -> ' + m[1]);
    }
  }
  assert(bad.length === 0, 'wxml 图片不存在: ' + bad.join(' | '));
});

test('可运行性：字面跳转地址必须是已注册页面且跳法正确（2026-10-21 深查补）', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const allPages = new Set(app.pages || []);
  for (const sp of app.subpackages || app.subPackages || []) {
    for (const p of sp.pages || []) allPages.add(path.join(sp.root, p).split(path.sep).join('/'));
  }
  const tabPages = new Set(((app.tabBar && app.tabBar.list) || []).map((i) => i.pagePath));
  const bad = [];
  const check = (url, from, kind) => {
    if (!url || url.startsWith('http') || url.includes('${')) return;
    const clean = url.split('?')[0].replace(/^\//, '');
    if (!allPages.has(clean)) { bad.push(`${from} 跳转目标不存在: ${url}`); return; }
    if (kind === 'switchTab' && !tabPages.has(clean)) bad.push(`${from} switchTab 跳非 Tab 页: ${url}`);
    if (kind === 'navigateTo' && tabPages.has(clean)) bad.push(`${from} navigateTo 跳 Tab 页: ${url}`);
  };
  for (const f of walk(ROOT, '.js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/wx\.(navigateTo|switchTab|redirectTo|reLaunch)\(\{[^}]*?url:\s*'([^']+)'/gs)) {
      check(m[2], path.relative(REPO, f), m[1]);
    }
  }
  for (const f of walk(ROOT, '.wxml')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<navigator[^>]*url="([^"]+)"/g)) check(m[1], path.relative(REPO, f), 'navigateTo');
  }
  assert(bad.length === 0, bad.join(' | '));
});

test('可运行性：preloadRule 引用的分包必须是已声明的 root（若配置存在；2026-10-21 起因工具版本解析口径不一致已整体删除该配置，功能不受影响）', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const roots = new Set(((app.subpackages || app.subPackages || [])).map((s) => s.root));
  const bad = [];
  for (const [page, rule] of Object.entries(app.preloadRule || {})) {
    for (const pkg of rule.packages || []) {
      if (!roots.has(pkg)) bad.push(`${page} -> ${pkg}`);
    }
  }
  assert(bad.length === 0, 'preloadRule 引用了不存在的分包 root: ' + bad.join(' | '));
});

test('可运行性：components 目录下每个组件四件套齐全且声明 component:true', () => {
  const dir = path.join(ROOT, 'components');
  const bad = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const base = path.join(dir, e.name, e.name);
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      if (!fs.existsSync(base + ext)) bad.push(e.name + ' 缺 ' + ext);
    }
    if (fs.existsSync(base + '.json')) {
      const cj = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
      if (cj.component !== true) bad.push(e.name + ' 未声明 component:true');
    }
  }
  assert(bad.length === 0, bad.join(' | '));
});
