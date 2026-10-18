/**
 * 金额绕过扫描测试（检查点1修改意见第4条，高风险：金额）
 * 规则：core/format.js 是全产品唯一的金额显示入口。
 * - miniprogram/**（页面/组件/服务）的 .js 与 .wxml 里，不许出现 /100、toFixed(、toLocaleString(
 * - core/**（除 format.js）里，不许出现 toFixed(、toLocaleString(
 * 新增绕过写法会导致本测试失败。
 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 去掉注释与字符串字面量，保留模板字符串里的 ${...} 代码
function stripNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          out += ' ' + src.slice(start, i - 1) + ' ';
        } else {
          i++;
        }
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function walk(dir, exts, acc) {
  acc = acc || [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, exts, acc);
    else if (exts.indexOf(path.extname(name)) >= 0) acc.push(p);
  }
  return acc;
}

const MINI_JS = walk(path.join(ROOT, 'miniprogram'), ['.js'])
  // miniprogram/core/format.js 是 core/format.js 的同步副本，即被许可的唯一入口
  .filter((p) => p.split(path.sep).pop() !== 'format.js');
const MINI_WXML = walk(path.join(ROOT, 'miniprogram'), ['.wxml']);
const CORE_JS = walk(path.join(ROOT, 'core'), ['.js'])
  .filter((p) => p.split(path.sep).pop() !== 'format.js');

const PATTERNS_MINI = [
  { name: '除以100拼金额', re: /\/\s*100\b/ },
  { name: 'toFixed 拼金额', re: /\.toFixed\s*\(/ },
  { name: 'toLocaleString 拼金额', re: /\.toLocaleString\s*\(/ },
];
const PATTERNS_CORE = [
  { name: 'toFixed 拼金额', re: /\.toFixed\s*\(/ },
  { name: 'toLocaleString 拼金额', re: /\.toLocaleString\s*\(/ },
];

function scan(files, patterns) {
  const hits = [];
  for (const f of files) {
    const clean = stripNoise(fs.readFileSync(f, 'utf8'));
    for (const p of patterns) {
      if (p.re.test(clean)) {
        hits.push(path.relative(ROOT, f) + '：发现「' + p.name + '」，请改调 core/format.js 的 formatAmount');
      }
    }
  }
  return hits;
}

test('金额显示无绕过：miniprogram 页面/组件/服务', () => {
  const hits = scan(MINI_JS.concat(MINI_WXML), PATTERNS_MINI);
  assert(hits.length === 0, hits.length ? '绕过写法：\n' + hits.join('\n') : '无绕过');
});

test('金额显示无绕过：core（format.js 除外）', () => {
  const hits = scan(CORE_JS, PATTERNS_CORE);
  assert(hits.length === 0, hits.length ? '绕过写法：\n' + hits.join('\n') : '无绕过');
});
