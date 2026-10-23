/**
 * 保存防重复锁门禁（任务AE 第 1 项）：真机实测——云端保存慢时连点「保存」
 * 会重复记账。全部记账保存页的 onSave 必须带 _saving 在途锁：
 * 入口 `if (this._saving) return;`、await 前置 true、finally 复位。
 * 购买页（buyingId 状态锁）与导入确认（writing 状态锁）已有等效锁，一并断言不回退。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const ROOT = path.join(__dirname, '..', 'miniprogram', 'pages');
const SAVE_PAGES = [
  'gift-add/gift-add.js',
  'gift-edit/gift-edit.js',
  'receive-add/receive-add.js',
  'receive-record-add/receive-record-add.js',
  'receive-record-edit/receive-record-edit.js',
];

for (const rel of SAVE_PAGES) {
  test(`保存锁：${rel} 的 onSave 带 _saving 在途锁`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const i = src.indexOf('async onSave()');
    assert(i >= 0, '应有 onSave');
    const body = src.slice(i, i + 2200);
    const guard = body.indexOf('if (this._saving) return;');
    const set = body.indexOf('this._saving = true;');
    const fin = body.indexOf('} finally {');
    const reset = body.indexOf('this._saving = false;');
    assert(guard >= 0, 'onSave 入口应有 _saving 守卫');
    assert(set > guard, 'await 前应置 _saving = true');
    assert(fin > set, '应有 finally 收尾');
    assert(reset > fin, 'finally 内应复位 _saving = false');
  });
}

test('保存锁：购买页与导入确认页的既有状态锁不回退', () => {
  const purchase = fs.readFileSync(path.join(ROOT, 'member/purchase/purchase.js'), 'utf8');
  assert(purchase.includes('if (!planId || this.data.buyingId) return;'), '购买套餐应有 buyingId 锁');
  assert(purchase.includes('if (!packId || this.data.buyingId) return;'), '购买积分包应有 buyingId 锁');
  const review = fs.readFileSync(path.join(ROOT, 'import/import-review.js'), 'utf8');
  assert(review.includes('if (this.data.writing || this.data.done) return;'), '导入确认应有 writing 锁');
});
