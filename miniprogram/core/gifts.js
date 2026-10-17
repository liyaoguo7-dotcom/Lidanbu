/**
 * 礼单簿 · 送礼记录 CRUD（T1.3）
 * v3.1 §13：独立时间流水；同一联系人多次逐笔显示，不合并。
 */
const errors = require('./errors');

const { COLLECTIONS, now } = require('./models');
const authz = require('./authz');
const quota = require('./quota');
const audit = require('./audit');
const { today } = require('./receive');

async function getOwner(db, ownerId) {
  return db.collection(COLLECTIONS.User).findOne({ _id: ownerId });
}

async function createGift(db, actorId, ownerId, { contactId, tagId, amount, remark = '', date }) {
  const c = await authz.check(db, actorId, 'add', { kind: 'giftRecord', ownerId });
  if (!c.ok) throw errors.permDenied(c.reason);

  const user = await getOwner(db, ownerId);
  // 成员新增计账本主人额度（第19章#4建议，待确认）
  const q = await quota.checkAddQuota(db, user, 'gift');
  if (!q.ok) throw errors.quotaDenied(q.reason);

  if (!Number.isInteger(amount) || amount <= 0) throw new Error('金额须为正整数（分）');
  const ck = await authz.check(db, actorId, 'read', { kind: 'contact', ownerId, contactId });
  if (!ck.ok) throw errors.permDenied(ck.reason);

  const { _id } = await db.collection(COLLECTIONS.GiftRecord).insert({
    ownerId, contactId, tagId, amount, remark,
    date: date || today(), createdBy: actorId, createdAt: now(),
  });
  await audit.log(db, { ownerId, actorId, action: 'create', targetType: 'giftRecord', targetId: _id, detail: '新增送礼记录' });
  return { _id };
}

async function updateGift(db, actorId, ownerId, giftId, patch) {
  const g = await db.collection(COLLECTIONS.GiftRecord).findOne({ _id: giftId, ownerId });
  if (!g) throw new Error('记录不存在');
  const c = await authz.check(db, actorId, 'edit', { kind: 'giftRecord', ownerId });
  if (!c.ok) throw errors.permDenied(c.reason);
  const user = await getOwner(db, ownerId);
  const q = await quota.checkEditAllowed(db, user, 'gift', giftId);
  if (!q.ok) throw errors.quotaDenied(q.reason);
  if (patch.amount !== undefined && (!Number.isInteger(patch.amount) || patch.amount <= 0)) {
    throw new Error('金额须为正整数（分）');
  }
  await db.collection(COLLECTIONS.GiftRecord).update({ _id: giftId }, patch);
  await audit.log(db, { ownerId, actorId, action: 'update', targetType: 'giftRecord', targetId: giftId, detail: '修改送礼记录' });
}

async function deleteGift(db, actorId, ownerId, giftId) {
  const g = await db.collection(COLLECTIONS.GiftRecord).findOne({ _id: giftId, ownerId });
  if (!g) throw new Error('记录不存在');
  const c = await authz.check(db, actorId, 'delete', { kind: 'giftRecord', ownerId });
  if (!c.ok) throw errors.permDenied(c.reason);
  await db.collection(COLLECTIONS.GiftRecord).remove({ _id: giftId });
  await audit.log(db, { ownerId, actorId, action: 'delete', targetType: 'giftRecord', targetId: giftId, detail: '删除送礼记录' });
}

async function listGifts(db, actorId, ownerId) {
  const c = await authz.check(db, actorId, 'read', { kind: 'giftRecord', ownerId });
  if (!c.ok) throw errors.permDenied(c.reason);
  return db.collection(COLLECTIONS.GiftRecord).find({ ownerId }, { sort: { createdAt: -1 } });
}

module.exports = { createGift, updateGift, deleteGift, listGifts };
