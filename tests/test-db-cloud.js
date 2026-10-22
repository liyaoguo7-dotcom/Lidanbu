/** CloudDB 测试：用假 wx-server-sdk（内存）在本地验证与 MemoryDB 同口径 */
const { CloudDB } = require('../core/db-cloud');
const { makeFakeSdk } = require('./fake-cloud-sdk');
const { test, assert } = require('./fw');

test('CloudDB：增删改查与查询 DSL（$in/范围/排序/限量）', async () => {
  const db = new CloudDB({ sdk: makeFakeSdk() });
  const col = db.collection('contacts');
  const a = await col.insert({ ownerId: 'u1', name: '张三', createdAt: 3 });
  const b = await col.insert({ ownerId: 'u1', name: '李四', createdAt: 1 });
  await col.insert({ ownerId: 'u2', name: '王五', createdAt: 2 });
  assert(a._id && b._id && a._id !== b._id, '自动生成 _id 且不重复');

  const mine = await col.find({ ownerId: 'u1' }, { sort: { createdAt: -1 } });
  assert.eq(mine.length, 2, '按 owner 查到 2 条');
  assert.eq(mine[0].name, '张三', '倒序第一条是 createdAt 最大');

  const inRes = await col.find({ name: { $in: ['李四', '王五'] } });
  assert.eq(inRes.length, 2, '$in 命中 2 条');

  const range = await col.find({ createdAt: { $gte: 2, $lte: 3 } });
  assert.eq(range.length, 2, '范围组合命中 2 条');

  const one = await col.findOne({ name: '李四' });
  assert.eq(one.ownerId, 'u1', 'findOne 命中');
  assert.eq(await col.findOne({ name: '不存在' }), null, 'findOne 未命中返回 null');
  assert.eq(await col.count({ ownerId: 'u1' }), 2, 'count 正确');

  const lim = await col.find({}, { limit: 2 });
  assert.eq(lim.length, 2, 'limit 生效');

  const up = await col.update({ ownerId: 'u1' }, { remark: 'x' });
  assert.eq(up.updated, 2, '批量更新 2 条');
  assert.eq((await col.findOne({ name: '张三' })).remark, 'x', '更新落值');

  const rm = await col.remove({ ownerId: 'u2' });
  assert.eq(rm.removed, 1, '删除 1 条');
  assert.eq(await col.count({}), 2, '删后剩 2 条');
});

test('CloudDB：带 _id 插入走 doc.set 且 data 不含 _id；分页拉取超过 100 条', async () => {
  const db = new CloudDB({ sdk: makeFakeSdk() });
  const users = db.collection('users');
  const r = await users.insert({ _id: 'openid-abc', nickname: '诺亚' });
  assert.eq(r._id, 'openid-abc', '指定 _id 保住');
  assert.eq((await users.findOne({ _id: 'openid-abc' })).nickname, '诺亚', '按 _id 可查回');

  const col = db.collection('giftRecords');
  for (let i = 0; i < 230; i++) await col.insert({ ownerId: 'u9', n: i });
  const all = await col.find({ ownerId: 'u9' });
  assert.eq(all.length, 230, '分页拉满 230 条（单次上限 100）');
  const first150 = await col.find({ ownerId: 'u9' }, { limit: 150 });
  assert.eq(first150.length, 150, 'limit 跨页正确');
});
