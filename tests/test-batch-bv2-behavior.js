/** BV2批：横置重复打开秒开——本子快照缓存＋后台静默刷新。
 * 用户口径：第一次打开等可以，后边每次打开再延迟不可接受。
 * 快照按书隔离（送礼整本／收礼按 eventId），字体／样式换过即作废回落全量；
 * 门禁仍在快照渲染之前；后台刷新静默（失败不弹 toast）。
 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8');
const { createBookPage } = require('../miniprogram/pages/landscape/book-common.js');

test('BV2 快照：helpers 在位、onLoad 快照分支先揭盖后静默刷新', () => {
  const js = readMp('pages/landscape/book-common.js');
  for (const fn of ['_snapKey()', '_readSnapshot(prefs)', '_applySnapshot(s)', '_writeSnapshot()']) {
    assert(js.includes(fn), `快照方法在位：${fn}`);
  }
  assert(js.includes('const snap = this._readSnapshot(prefs);'), 'onLoad 读快照');
  assert(js.includes('this.reload({ silent: true })'), '快照分支后台静默刷新');
  assert(js.includes('async reload(opts)'), 'reload 接受静默选项');
  assert(js.includes('if (!opts || !opts.silent) wx.showToast'), '非静默才弹加载失败');
  assert(js.includes('this._writeSnapshot(); // BV2：列模型新鲜出炉即更新快照'), '重查后更新快照');
});

test('BV2 快照：写读往返＋字体／书不对即作废＋脏数据不炸', () => {
  const store = {};
  const prevWx = global.wx;
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
  };
  try {
    const page = createBookPage('receive');
    // 上下文从页面对象继承（_snapKey 等方法走原型链），只覆盖数据字段
    const ctx = Object.create(page);
    ctx._ownerId = ''; ctx._eventId = 'ev1';
    ctx._event = { _id: 'ev1', name: '婚宴', tagId: 'jiehun', date: '2026-10-28' };
    ctx._recordsById = { r1: { _id: 'r1', contactName: '张三', amount: 10000 } };
    ctx.data = {
      fontId: 'lxgw', styleId: 'classic', theme: { id: 'classic' },
      titleName: '婚宴', titleDate: '2026-10-28', titleIcon: '',
      emptyBook: false, allColumns: [{ key: 'c1', name: '张三' }],
    };
    page._writeSnapshot.call(ctx);
    const snap = page._readSnapshot.call(ctx, { fontId: 'lxgw', styleId: 'classic' });
    assert(snap && snap.eventId === 'ev1', '快照写读往返');
    assert(snap.allColumns.length === 1 && snap.records.length === 1, '列模型与记录表都在快照里');
    assert(page._readSnapshot.call(ctx, { fontId: 'mashanzheng', styleId: 'classic' }) === null, '字体换过快照作废');
    assert(page._readSnapshot.call(ctx, { fontId: 'lxgw', styleId: 'bamboo' }) === null, '样式换过快照作废');
    const ctxOther = Object.create(ctx);
    ctxOther._eventId = 'ev2';
    assert(page._readSnapshot.call(ctxOther, { fontId: 'lxgw', styleId: 'classic' }) === null, '换书快照作废');
    store[page._snapKey.call(ctx)] = 'not-json{{';
    assert(page._readSnapshot.call(ctx, { fontId: 'lxgw', styleId: 'classic' }) === null, '脏快照不炸、回落全量');
  } finally {
    global.wx = prevWx;
  }
});
