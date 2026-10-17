/** WxStorageDB 适配器测试（内存后端注入，不依赖 wx） */
const { WxStorageDB } = require('../miniprogram/services/db-wxstorage');
const { test, assert } = require('./fw');

function memStorage() {
  const m = new Map();
  return {
    get(k) { return m.has(k) ? m.get(k) : undefined; },
    set(k, v) { m.set(k, v); },
    remove(k) { m.delete(k); },
  };
}

test('WxStorageDB：增删改查与 MemoryDB 接口一致', async () => {
  const db = new WxStorageDB(memStorage());
  const col = db.collection('contacts');
  const { _id } = await col.insert({ name: '张三', ownerId: 'u1' });
  assert(_id, '应返回 _id');
  const one = await col.findOne({ _id });
  assert.eq(one.name, '张三', 'findOne');
  assert.eq(await col.count({ ownerId: 'u1' }), 1, 'count');
  await col.update({ _id }, { remark: '同学' });
  assert.eq((await col.findOne({ _id })).remark, '同学', 'update');
  const all = await col.find({ ownerId: 'u1' }, { sort: { name: 1 } });
  assert.eq(all.length, 1, 'find+sort');
  await col.remove({ _id });
  assert.eq(await col.count({}), 0, 'remove');
});

test('WxStorageDB：$in/$gte 查询与换实例后数据仍在（持久化）', async () => {
  const st = memStorage();
  const db1 = new WxStorageDB(st, 'pre_');
  await db1.collection('gifts').insert({ amount: 1000, date: '2026-10-01' });
  await db1.collection('gifts').insert({ amount: 2000, date: '2026-10-02' });
  const db2 = new WxStorageDB(st, 'pre_');
  assert.eq(await db2.collection('gifts').count({}), 2, '新实例读到旧数据');
  const hit = await db2.collection('gifts').find({ amount: { $gte: 1500 } });
  assert.eq(hit.length, 1, '$gte');
  const hit2 = await db2.collection('gifts').find({ date: { $in: ['2026-10-01'] } });
  assert.eq(hit2.length, 1, '$in');
  // 不同前缀隔离
  const db3 = new WxStorageDB(st, 'other_');
  assert.eq(await db3.collection('gifts').count({}), 0, '前缀隔离');
});

test('WxStorageDB：损坏的存储内容不抛错，视为空集合', async () => {
  const st = memStorage();
  st.set('pre_contacts', '{not-json');
  const db = new WxStorageDB(st, 'pre_');
  assert.eq(await db.collection('contacts').count({}), 0, '损坏内容视为空');
});
