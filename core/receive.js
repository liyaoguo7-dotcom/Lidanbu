/**
 * 礼单簿 · 收礼事件/记录 CRUD（T1.3）
 * v3.1 §12：礼薄含标签/日期/名称/备注；明细含联系人/金额/类型/备注。
 *
 * 口径（待确认，见报告）：
 * - 收礼事件（礼薄）只有主人可增删改；成员的 add/edit/del 开关只作用于明细记录。
 *   依据：第19章#2"可修改是否拆分"待确认，取保守口径。
 * - 事件名称查重范围按第19章#16建议：同一账本内不能完全重名（待确认）。
 */
const errors = require('./errors');

const { COLLECTIONS, now } = require('./models');
const authz = require('./authz');
const quota = require('./quota');
const audit = require('./audit');
const restriction = require('./restriction');

async function getOwner(db, ownerId) {
  return db.collection(COLLECTIONS.User).findOne({ _id: ownerId });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- 收礼事件（礼薄） ---------- */

async function createEvent(db, actorId, ownerId, { name, tagId, date, remark = '' }) {
  await restriction.assertWritable(db, actorId);
  if (!name || !name.trim()) throw new Error('礼薄名称必填');
  // 只有主人可建事件（成员开关只作用于明细，见文件头口径）
  if (actorId !== ownerId) throw new Error('无权限：仅账本主人可新建礼薄');

  // 查重：同一账本内名称不能完全重复（第19章#16建议，待确认）
  const dup = await db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId, name: name.trim() });
  if (dup > 0) throw new Error('同一账本内礼薄名称不能完全重复');

  const user = await getOwner(db, ownerId);
  const q = await quota.checkAddQuota(db, user, 'event');
  if (!q.ok) throw errors.quotaDenied(q.reason);

  const { _id } = await db.collection(COLLECTIONS.ReceiveEvent).insert({
    ownerId, name: name.trim(), tagId, date: date || today(), remark, createdAt: now(),
  });
  await audit.log(db, { ownerId, actorId, action: 'create', targetType: 'event', targetId: _id, detail: '新建礼薄' });
  return { _id };
}

async function updateEvent(db, actorId, ownerId, eventId, patch) {
  await restriction.assertWritable(db, actorId);
  if (actorId !== ownerId) throw new Error('无权限：仅账本主人可修改礼薄');
  const user = await getOwner(db, ownerId);
  const q = await quota.checkEditAllowed(db, user, 'event', eventId);
  if (!q.ok) throw errors.quotaDenied(q.reason);
  if (patch.name) {
    const dup = await db.collection(COLLECTIONS.ReceiveEvent).count({ ownerId, name: patch.name.trim() });
    if (dup > 0) {
      const self = await db.collection(COLLECTIONS.ReceiveEvent).findOne({ _id: eventId });
      if (!self || self.name !== patch.name.trim()) throw new Error('同一账本内礼薄名称不能完全重复');
    }
    patch.name = patch.name.trim();
  }
  await db.collection(COLLECTIONS.ReceiveEvent).update({ _id: eventId, ownerId }, patch);
  await audit.log(db, { ownerId, actorId, action: 'update', targetType: 'event', targetId: eventId, detail: '修改礼薄' });
}

async function deleteEvent(db, actorId, ownerId, eventId) {
  await restriction.assertWritable(db, actorId);
  if (actorId !== ownerId) throw new Error('无权限：仅账本主人可删除礼薄');
  const n = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId, eventId });
  await db.collection(COLLECTIONS.ReceiveRecord).remove({ ownerId, eventId });
  await db.collection(COLLECTIONS.ReceiveEvent).remove({ _id: eventId, ownerId });
  await audit.log(db, { ownerId, actorId, action: 'delete', targetType: 'event', targetId: eventId, detail: `删除礼薄，连带明细${n}条` });
  return { removedRecords: n };
}

async function listEvents(db, actorId, ownerId) {
  const all = await db.collection(COLLECTIONS.ReceiveEvent).find({ ownerId }, { sort: { createdAt: -1 } });
  if (actorId === ownerId) return all;
  const pre = await authz.checkMemberAccess(db, actorId, ownerId);
  if (!pre.ok || !pre.switches.view) return [];
  return all.filter((e) => pre.scope.events.includes(e._id));
}

/* ---------- 收礼明细记录 ---------- */

async function createRecord(db, actorId, ownerId, eventId, { contactId, amount, type, remark = '', date }) {
  await restriction.assertWritable(db, actorId);
  const c = await authz.check(db, actorId, 'add', { kind: 'receiveRecord', ownerId, eventId });
  if (!c.ok) throw errors.permDenied(c.reason);

  const user = await getOwner(db, ownerId);
  // 成员新增计账本主人额度（第19章#4建议：算账本主人的额度，待确认）
  const q = await quota.checkAddQuota(db, user, 'receiveRecord', undefined, eventId);
  if (!q.ok) throw errors.quotaDenied(q.reason);

  if (!Number.isInteger(amount) || amount <= 0) throw new Error('金额须为正整数（分）');
  // 联系人必须可见（成员只能选已授权可见的）
  const ck = await authz.check(db, actorId, 'read', { kind: 'contact', ownerId, contactId });
  if (!ck.ok) throw errors.permDenied(ck.reason);

  const { _id } = await db.collection(COLLECTIONS.ReceiveRecord).insert({
    ownerId, eventId, contactId, amount, type, remark,
    date: date || today(), createdBy: actorId, createdAt: now(),
  });
  await audit.log(db, { ownerId, actorId, action: 'create', targetType: 'receiveRecord', targetId: _id, detail: '新增收礼明细' });
  return { _id };
}

async function updateRecord(db, actorId, ownerId, recordId, patch) {
  await restriction.assertWritable(db, actorId);
  const rec = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: recordId, ownerId });
  if (!rec) throw new Error('记录不存在');
  const c = await authz.check(db, actorId, 'edit', { kind: 'receiveRecord', ownerId, eventId: rec.eventId });
  if (!c.ok) throw errors.permDenied(c.reason);
  const user = await getOwner(db, ownerId);
  const q = await quota.checkEditAllowed(db, user, 'receiveRecord', recordId);
  if (!q.ok) throw errors.quotaDenied(q.reason);
  if (patch.amount !== undefined && (!Number.isInteger(patch.amount) || patch.amount <= 0)) {
    throw new Error('金额须为正整数（分）');
  }
  await db.collection(COLLECTIONS.ReceiveRecord).update({ _id: recordId }, patch);
  await audit.log(db, { ownerId, actorId, action: 'update', targetType: 'receiveRecord', targetId: recordId, detail: '修改收礼明细' });
}

async function deleteRecord(db, actorId, ownerId, recordId) {
  await restriction.assertWritable(db, actorId);
  const rec = await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: recordId, ownerId });
  if (!rec) throw new Error('记录不存在');
  const c = await authz.check(db, actorId, 'delete', { kind: 'receiveRecord', ownerId, eventId: rec.eventId });
  if (!c.ok) throw errors.permDenied(c.reason);
  await db.collection(COLLECTIONS.ReceiveRecord).remove({ _id: recordId });
  await audit.log(db, { ownerId, actorId, action: 'delete', targetType: 'receiveRecord', targetId: recordId, detail: '删除收礼明细' });
}

async function listRecords(db, actorId, ownerId, eventId) {
  const c = await authz.check(db, actorId, 'read', { kind: 'receiveRecord', ownerId, eventId });
  if (!c.ok) throw errors.permDenied(c.reason);
  return db.collection(COLLECTIONS.ReceiveRecord).find({ ownerId, eventId }, { sort: { createdAt: -1 } });
}

module.exports = { createEvent, updateEvent, deleteEvent, listEvents, createRecord, updateRecord, deleteRecord, listRecords, today };
