/** 示例页守卫：已注册、四件套齐全、只读且不连真实数据（无 data-service 引用） */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['pages/example/receive-example', 'pages/example/gift-example'];

test('示例页：app.json 已注册收礼/送礼示例页', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  for (const p of PAGES) {
    assert(app.pages.includes(p), `已注册 ${p}`);
  }
});

test('示例页：四件套齐全且只读、不连真实数据', () => {
  for (const p of PAGES) {
    for (const ext of ['js', 'wxml', 'wxss', 'json']) {
      assert(fs.existsSync(path.join(ROOT, 'miniprogram', `${p}.${ext}`)), `${p}.${ext} 存在`);
    }
    const js = fs.readFileSync(path.join(ROOT, 'miniprogram', `${p}.js`), 'utf8');
    assert(!/data-service/.test(js), `${p} 不引用 data-service（不连真实数据）`);
    assert(!/createGift|createRecord|createContact|importWrite/.test(js), `${p} 无任何写入调用`);
    const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram', `${p}.wxml`), 'utf8');
    assert(/示例/.test(wxml), `${p} 带示例标识`);
  }
});

test('示例页：收礼/送礼入口已接线（不再是占位 toast）', () => {
  const receive = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/receive/receive.js'), 'utf8');
  assert(/pages\/example\/receive-example/.test(receive), '收礼页入口跳 receive-example');
  assert(!/示例页占位/.test(receive), '收礼页占位 toast 已移除');
  const giftsJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/gifts/gifts.js'), 'utf8');
  assert(/pages\/example\/gift-example/.test(giftsJs), '送礼页入口跳 gift-example');
  const giftsWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/gifts/gifts.wxml'), 'utf8');
  assert(/bindtap="goSample"/.test(giftsWxml), '送礼页"点击查看示例"已绑点击');
});
