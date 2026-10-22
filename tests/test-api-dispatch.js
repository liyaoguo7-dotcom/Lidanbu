/** api 云函数分发：假 SDK + 同步进云函数的 core 副本，在进程内跑通全链路
 * （等于把云端 api 提前在本地联调一遍；真云端只剩 SDK 本身的差异） */
const path = require('path');
const { makeFakeSdk } = require('./fake-cloud-sdk');
const { test, assert } = require('./fw');

const API_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api');
// eslint-disable-next-line import/no-dynamic-require
const core = require(path.join(API_DIR, 'core'));
// eslint-disable-next-line import/no-dynamic-require
const { createMain } = require(path.join(API_DIR, 'index.js'));

function makeMain(openid) {
  const sdk = makeFakeSdk();
  sdk.getWXContext = () => ({ OPENID: openid });
  const db = new core.db.CloudDB({ sdk });
  return createMain({ sdk, core, db });
}

test('api分发：whoami 返回服务端 openid；未知 action 被拒', async () => {
  const main = makeMain('owner-1');
  const me = await main({ action: 'whoami' });
  assert(me.ok && me.data.openid === 'owner-1', 'whoami 应返回 OPENID');
  const bad = await main({ action: 'models.COLLECTIONS' });
  assert(bad.ok === false, '未开放模块应被拒');
  const bad2 = await main({ action: 'contacts.nope' });
  assert(bad2.ok === false, '不存在的函数应被拒');
});

test('api分发：亲友→礼薄→收礼→往来统计 全链路（服务端 core + CloudDB）', async () => {
  const main = makeMain('owner-2');
  const c = await main({ action: 'contacts.createContact', args: ['owner-2', { name: '张三', remark: '' }] });
  assert(c.ok, `建亲友失败：${c.error || ''}`);
  const contactId = (c.data.contact && c.data.contact._id) || c.data._id || c.data.id;
  assert(contactId, '应拿到亲友 ID');

  const ev = await main({ action: 'receive.createEvent', args: ['owner-2', { name: '张三的婚礼', tagId: 'wedding' }] });
  assert(ev.ok, `建礼薄失败：${ev.error || ''}`);
  const eventId = (ev.data.event && ev.data.event._id) || ev.data._id || ev.data.id;
  assert(eventId, '应拿到礼薄 ID');

  const rec = await main({
    action: 'receive.createRecord',
    args: ['owner-2', eventId, { contactId, amount: 100000, type: '现金' }],
  });
  assert(rec.ok, `记收礼失败：${rec.error || ''}`);

  const stats = await main({ action: 'stats.getWanglaiStats', args: ['owner-2', { preset: 'all' }] });
  assert(stats.ok, `统计失败：${stats.error || ''}`);
  assert.eq(stats.data.receiveTotal, 100000, '收礼总额应为 100000 分');
  assert.eq(stats.data.receiveCount, 1, '收礼 1 笔');
});
