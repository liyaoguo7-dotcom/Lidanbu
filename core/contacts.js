/**
 * 礼单簿 · 联系人 CRUD（T1.3）
 * v3.1 §6.3：只有姓名+备注；重名只提醒不合并；稳定 ID 关联。
 * 口径（待确认，见报告）：成员不可增删改主人亲友录；新增记录时只能选已授权可见联系人。
 */

const { COLLECTIONS, now } = require('./models');
const authz = require('./authz');
const quota = require('./quota');
const audit = require('./audit');

async function getOwner(db, ownerId) {
  return db.collection(COLLECTIONS.User).findOne({ _id: ownerId });
}

async function createContact(db, actorId, ownerId, { name, remark = '' }) {
  if (!name || !name.trim()) throw new Error('姓名必填');
  // 授权：成员不可动主人亲友录（authz 内部已实现）
  const c = await authz.check(db, actorId, 'add', { kind: 'contact', ownerId });
  if (!c.ok) throw new Error(`无权限新增联系人:${c.reason}`);

  const user = await getOwner(db, ownerId);
  const q = await quota.checkAddQuota(db, user, 'contact');
  if (!q.ok) throw new Error(q.reason);

  // 重名检测：只提醒，不阻止、不合并
  const dup = await db.collection(COLLECTIONS.Contact).count({ ownerId, name: name.trim() });

  const { _id } = await db.collection(COLLECTIONS.Contact).insert({
    ownerId, name: name.trim(), remark, createdAt: now(),
  });
  await audit.log(db, { ownerId, actorId, action: 'create', targetType: 'contact', targetId: _id, detail: '新增联系人' });
  return { _id, duplicateWarning: dup > 0 };
}

async function updateContact(db, actorId, ownerId, contactId, { name, remark }) {
  const c = await authz.check(db, actorId, 'edit', { kind: 'contact', ownerId, contactId });
  if (!c.ok) throw new Error(`无权限修改联系人:${c.reason}`);
  const user = await getOwner(db, ownerId);
  const q = await quota.checkEditAllowed(db, user, 'contact', contactId);
  if (!q.ok) throw new Error(q.reason);

  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (remark !== undefined) patch.remark = remark;
  await db.collection(COLLECTIONS.Contact).update({ _id: contactId, ownerId }, patch);
  await audit.log(db, { ownerId, actorId, action: 'update', targetType: 'contact', targetId: contactId, detail: '修改联系人' });
}

/** 删除联系人影响条数（供弹窗使用，v3.1 §3.8） */
async function countImpact(db, ownerId, contactId) {
  const receiveCount = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId, contactId });
  const giftCount = await db.collection(COLLECTIONS.GiftRecord).count({ ownerId, contactId });
  return { receiveCount, giftCount };
}

/**
 * 删除联系人：两步。confirmed=false 只返回影响条数；true 才执行
 * 连带永久删除其全部往来记录（v3.1 第零章#3），审计留痕。
 */
async function deleteContact(db, actorId, ownerId, contactId, confirmed = false) {
  const impact = await countImpact(db, ownerId, contactId);
  if (!confirmed) return { confirmed: false, ...impact };

  const c = await authz.check(db, actorId, 'delete', { kind: 'contact', ownerId, contactId });
  if (!c.ok) throw new Error(`无权限删除联系人:${c.reason}`);

  await db.collection(COLLECTIONS.ReceiveRecord).remove({ ownerId, contactId });
  await db.collection(COLLECTIONS.GiftRecord).remove({ ownerId, contactId });
  await db.collection(COLLECTIONS.Contact).remove({ _id: contactId, ownerId });
  await audit.log(db, {
    ownerId, actorId, action: 'delete', targetType: 'contact', targetId: contactId,
    detail: `删除联系人，连带收礼${impact.receiveCount}条、送礼${impact.giftCount}条`,
  });
  return { confirmed: true, ...impact };
}

async function listContacts(db, actorId, ownerId) {
  // 成员只能看到已授权记录里出现过的联系人（authz 按第19章#3建议过滤）
  const all = await db.collection(COLLECTIONS.Contact).find({ ownerId }, { sort: { createdAt: 1 } });
  if (actorId === ownerId) return all;
  const grant = await authz.getGrant(db, ownerId, actorId);
  if (!grant) return [];
  const visible = [];
  for (const ct of all) {
    const r = await authz.check(db, actorId, 'read', { kind: 'contact', ownerId, contactId: ct._id });
    if (r.ok) visible.push(ct);
  }
  return visible;
}

async function searchContacts(db, actorId, ownerId, keyword) {
  const all = await listContacts(db, actorId, ownerId);
  const kw = keyword.trim();
  if (!kw) return all;
  return all.filter((c) => c.name.includes(kw) || (c.remark && c.remark.includes(kw)));
}

module.exports = { createContact, updateContact, countImpact, deleteContact, listContacts, searchContacts };
