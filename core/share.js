/**
 * 礼单簿 · 共享管理接口（T1.6）
 * v3.1 §8：
 * - 邀请流程：先勾选权限（五个开关）和范围，再发出；"仅查看"恒勾选不可取消；
 *   至少勾选一个收礼事件或"送礼"才能发出
 * - 成员权限随时可改，立即生效（authz 实时查询，无缓存）
 * - 移除成员：其已新增记录保留在主人账本，并保留"谁加的"（createdBy）
 * - 新建事件默认不共享（不自动加入 scope.events）
 */

const { COLLECTIONS, now } = require('./models');
const audit = require('./audit');

const SWITCH_IDS = ['view', 'add', 'edit', 'del', 'export'];

function normalizeSwitches(input = {}) {
  const s = {};
  SWITCH_IDS.forEach((id) => { s[id] = !!input[id]; });
  s.view = true; // 仅查看恒为勾选，不可取消
  if (input.view === false) throw new Error('仅查看不可取消');
  return s;
}

function normalizeScope(input = {}) {
  return {
    events: Array.isArray(input.events) ? [...input.events] : [],
    gifts: !!input.gifts,
  };
}

/**
 * 发起邀请（主人操作）
 * @returns {{membershipId}}
 */
async function invite(db, ownerId, { switches, scope }) {
  const sw = normalizeSwitches(switches);
  const sc = normalizeScope(scope);
  if (sc.events.length === 0 && !sc.gifts) {
    throw new Error('至少勾选一个收礼事件或"送礼"才能发出邀请');
  }
  // 范围里的事件必须属于该主人
  for (const eid of sc.events) {
    const ev = await db.collection(COLLECTIONS.ReceiveEvent).findOne({ _id: eid, ownerId });
    if (!ev) throw new Error(`共享范围含不属于该账本的事件:${eid}`);
  }
  const { _id: membershipId } = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId, memberId: '', status: 'pending', createdAt: now(),
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId, switches: sw, scope: sc, updatedAt: now(),
  });
  await audit.log(db, { ownerId, actorId: ownerId, action: 'share', targetType: 'member', targetId: membershipId, detail: '发出家庭共享邀请' });
  return { membershipId };
}

/** 接受邀请（成员操作） */
async function accept(db, membershipId, memberId) {
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId });
  if (!ms) throw new Error('邀请不存在');
  if (ms.status !== 'pending') throw new Error('邀请已处理');
  await db.collection(COLLECTIONS.ShareMembership).update(
    { _id: membershipId },
    { memberId, status: 'active' }
  );
  await audit.log(db, { ownerId: ms.ownerId, actorId: memberId, action: 'share', targetType: 'member', targetId: membershipId, detail: '接受共享邀请' });
  return { ok: true };
}

/** 修改成员权限（主人操作，立即生效） */
async function updateGrant(db, ownerId, membershipId, { switches, scope }) {
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId, ownerId });
  if (!ms) throw new Error('成员关系不存在');
  const patch = { updatedAt: now() };
  if (switches) patch.switches = normalizeSwitches(switches);
  if (scope) {
    const sc = normalizeScope(scope);
    for (const eid of sc.events) {
      const ev = await db.collection(COLLECTIONS.ReceiveEvent).findOne({ _id: eid, ownerId });
      if (!ev) throw new Error(`共享范围含不属于该账本的事件:${eid}`);
    }
    patch.scope = sc;
  }
  await db.collection(COLLECTIONS.ShareGrant).update({ membershipId }, patch);
  await audit.log(db, { ownerId, actorId: ownerId, action: 'grant', targetType: 'member', targetId: membershipId, detail: '修改成员权限' });
  return { ok: true };
}

/**
 * 移除成员（主人操作）
 * 其此前新增的记录保留在主人账本，createdBy 保留"谁加的"
 */
async function removeMember(db, ownerId, membershipId) {
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId, ownerId });
  if (!ms) throw new Error('成员关系不存在');
  await db.collection(COLLECTIONS.ShareMembership).update({ _id: membershipId }, { status: 'removed' });
  // 记录保留：不删除 ReceiveRecord/GiftRecord，createdBy 原样保留
  await audit.log(db, { ownerId, actorId: ownerId, action: 'share', targetType: 'member', targetId: membershipId, detail: '移除成员，其新增记录保留' });
  return { ok: true };
}

/** 成员列表（含权限摘要） */
async function listMembers(db, ownerId) {
  const mss = await db.collection(COLLECTIONS.ShareMembership).find({ ownerId });
  const out = [];
  for (const ms of mss) {
    const grant = await db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId: ms._id });
    out.push({ ...ms, grant });
  }
  return out;
}

module.exports = { invite, accept, updateGrant, removeMember, listMembers, SWITCH_IDS };
