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
const restriction = require('./restriction');
const quota = require('./quota');
const errors = require('./errors');
const features = require('./features');
const users = require('./users');

/** 待接受邀请有效期（2026-10-31 用户定）：48 小时，超时自动失效。
 * 实现为惰性失效：查邀请、进成员管理、接受时按创建时间算，超期即标为
 * expired 且不再列出、不再接受；不真删库，审计留痕。 */
const PENDING_TTL_MS = 48 * 3600 * 1000;
function isPendingExpired(ms, at = now()) {
  return !!(ms && ms.status === 'pending' && typeof ms.createdAt === 'number'
    && (at - ms.createdAt) > PENDING_TTL_MS);
}
async function markExpiredIfNeeded(db, ms) {
  if (!isPendingExpired(ms)) return false;
  try {
    await db.collection(COLLECTIONS.ShareMembership).update({ _id: ms._id }, { status: 'expired' });
  } catch (e) { /* 标失效失败不堵主流程：调用方仍按失效处理 */ }
  return true;
}
/** 邀请人备注：只邀请人可见、不改被邀请人昵称；选填、限 16 字（按码点计）。 */
function normalizeRemark(input) {
  if (input === undefined || input === null) return undefined;
  const s = String(input).trim();
  return Array.from(s).slice(0, 16).join('');
}

/** 家庭共享总开关守卫（2026-10-25 用户加）：老板平台关掉后，共享的
 * 新建/接受/改权限/移除/列表一律拒绝（入口层另有提示，双保险）。 */
async function assertFamilyShareOn(db) {
  if (!(await features.familyShareEnabled(db))) {
    const e = new Error(errors.userMessage('family-share-closed'));
    e.code = 'family-share-closed';
    throw e;
  }
}
const notify = require('./notify');

/** 共享变更通知（任务L）：通知失败绝不影响共享操作本身 */
async function notifyShareChanged(db, userId, action) {
  if (!userId) return;
  try {
    await notify.notify(db, userId, 'shareChanged', { action });
  } catch (e) { /* 忽略 */ }
}

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
 * 会员专属功能 familyShareInvite：发起人须为有效会员（普通用户、
 * 已过缓冲期的会员一律拒绝，返回"需要开通会员"）；被邀请的家人可为普通用户。
 * @returns {{membershipId}}
 */
async function invite(db, ownerId, { switches, scope, remark }) {
  await assertFamilyShareOn(db);
  await restriction.assertWritable(db, ownerId);
  // 会员门禁（AM批接「会员功能」名单）：名单含 familyShareInvite 时，
  // 有效会员才能发起邀请（缓冲期内不算有效）；名单不含时免费用户也能邀。
  const inviter = await db.collection(COLLECTIONS.User).findOne({ _id: ownerId });
  // 管理员免会员（2026-10-30）：管理员可发起家庭共享邀请，不受会员门禁限制。
  if ((await features.isMemberOnlyFeature(db, 'familyShareInvite')) && !quota.isMemberActive(inviter || {}) && !(await quota.isAdminUser(db, ownerId))) {
    throw errors.memberRequired('家庭共享邀请');
  }
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
  const remarkNorm = normalizeRemark(remark);
  const { _id: membershipId } = await db.collection(COLLECTIONS.ShareMembership).insert({
    ownerId, memberId: '', status: 'pending', createdAt: now(), acceptedAt: null,
    remark: remarkNorm === undefined ? '' : remarkNorm,
  });
  await db.collection(COLLECTIONS.ShareGrant).insert({
    membershipId, switches: sw, scope: sc, updatedAt: now(),
  });
  await audit.log(db, { ownerId, actorId: ownerId, action: 'share', targetType: 'member', targetId: membershipId, detail: '发出家庭共享邀请' });
  return { membershipId };
}

/** 接受邀请（成员操作）。
 * 参数序 2026-10-23 任务AD 对调为全站统一的 (db, actorId, ...) 口径
 * （原 (db, membershipId, memberId) 与 api 分发约定冲突，云端无法调用）。 */
async function accept(db, memberId, membershipId) {
  await assertFamilyShareOn(db);
  await restriction.assertWritable(db, memberId);
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId });
  if (!ms) throw new Error('邀请不存在');
  if (ms.status === 'expired' || isPendingExpired(ms)) {
    await markExpiredIfNeeded(db, ms);
    throw new Error('邀请已失效，请让邀请人重新邀请');
  }
  if (ms.status !== 'pending') throw new Error('邀请已处理');
  await db.collection(COLLECTIONS.ShareMembership).update(
    { _id: membershipId },
    { memberId, status: 'active', acceptedAt: now() }
  );
  await audit.log(db, { ownerId: ms.ownerId, actorId: memberId, action: 'share', targetType: 'member', targetId: membershipId, detail: '接受共享邀请' });
  await notifyShareChanged(db, ms.ownerId, 'inviteAccepted'); // 通知主人：家人加入了
  return { ok: true };
}

/** 修改成员权限（主人操作，立即生效） */
async function updateGrant(db, ownerId, membershipId, { switches, scope, remark }) {
  await assertFamilyShareOn(db);
  await restriction.assertWritable(db, ownerId);
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId, ownerId });
  if (!ms) throw new Error('成员关系不存在');
  if (ms.status === 'removed') throw new Error('成员关系不存在');
  if (ms.status === 'expired' || isPendingExpired(ms)) {
    await markExpiredIfNeeded(db, ms);
    throw new Error('邀请已失效，请重新邀请');
  }
  const remarkNorm = normalizeRemark(remark);
  if (remarkNorm !== undefined) {
    await db.collection(COLLECTIONS.ShareMembership).update(
      { _id: membershipId }, { remark: remarkNorm });
  }
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
  await notifyShareChanged(db, ms.memberId, 'grantUpdated'); // 通知成员：权限变了
  return { ok: true };
}

/**
 * 移除成员（主人操作）
 * 其此前新增的记录保留在主人账本，createdBy 保留"谁加的"
 */
async function removeMember(db, ownerId, membershipId) {
  await assertFamilyShareOn(db);
  await restriction.assertWritable(db, ownerId);
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId, ownerId });
  if (!ms) throw new Error('成员关系不存在');
  await db.collection(COLLECTIONS.ShareMembership).update({ _id: membershipId }, { status: 'removed' });
  // 记录保留：不删除 ReceiveRecord/GiftRecord，createdBy 原样保留；
  // 待接受作废同样只改状态、不删库，之后不再列出。
  await audit.log(db, { ownerId, actorId: ownerId, action: 'share', targetType: 'member', targetId: membershipId, detail: ms.status === 'pending' ? '作废待接受邀请' : '移除成员，其新增记录保留' });
  await notifyShareChanged(db, ms.memberId, 'memberRemoved'); // 通知被移除的成员
  return { ok: true };
}

/** 成员列表（含权限摘要）——2026-10-31：超 48 小时待接受标失效且不再列出，
 * 已移除也不再列出；已接受排前、待接受排后；每条附备注、成员显示名、范围摘要、
 * 接受时间（旧记录无 acceptedAt 时调用方用发出时间兜底，见前端）。 */
async function listMembers(db, ownerId) {
  await assertFamilyShareOn(db);
  const mss = await db.collection(COLLECTIONS.ShareMembership).find({ ownerId });
  const events = await db.collection(COLLECTIONS.ReceiveEvent).find({ ownerId });
  const eventName = new Map(events.map((e) => [e._id, e.name]));
  const out = [];
  for (const ms of mss) {
    if (ms.status === 'removed' || ms.status === 'expired') continue;
    if (isPendingExpired(ms)) {
      await markExpiredIfNeeded(db, ms);
      continue;
    }
    const grant = await db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId: ms._id });
    let memberName = '';
    if (ms.memberId) {
      const memberUser = await db.collection(COLLECTIONS.User).findOne({ _id: ms.memberId });
      memberName = memberUser ? users.displayName(memberUser) : '';
    }
    const scopeEvents = (grant && grant.scope && Array.isArray(grant.scope.events))
      ? grant.scope.events : [];
    const scopeNames = scopeEvents.map((id) => eventName.get(id)).filter(Boolean);
    if (grant && grant.scope && grant.scope.gifts) scopeNames.push('送礼记录');
    out.push({
      ...ms,
      grant,
      remark: typeof ms.remark === 'string' ? ms.remark : '',
      memberName,
      scopeText: scopeNames.join('、'),
      scopeEventNames: scopeNames,
    });
  }
  out.sort((a, b) => {
    const rank = (s) => (s === 'active' ? 0 : 1);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return out;
}

/**
 * 读某成员的授权文档（任务AD 切云新增）：与 data-service 原直连读取同口径
 * （只按 membershipId 查 ShareGrant），供本地/云端共用一条路径。
 */
async function getGrant(db, ownerId, membershipId) {
  return db.collection(COLLECTIONS.ShareGrant).findOne({ membershipId });
}

/** 按 id 读共享关系文档（任务AD 切云新增）：分享落地页接受邀请前查状态用，同原直连口径；
 * 2026-10-31：待接受超 48 小时时标为 expired 再返回，调用方须按 expired 处理（不得当 pending 接受）。 */
async function getMembership(db, actorId, membershipId) {
  const ms = await db.collection(COLLECTIONS.ShareMembership).findOne({ _id: membershipId });
  if (!ms) return ms;
  if (isPendingExpired(ms)) {
    await markExpiredIfNeeded(db, ms);
    return { ...ms, status: 'expired' };
  }
  return ms;
}

/**
 * 我收到的共享列表（任务AD 切云新增）：与 data-service 原直连拼装同口径——
 * 本人 active 的共享关系 + 每位账本主人的用户文档（显示名由调用方本地解析，
 * 主人文档不存在时返回 owner:null，调用方兜底显示"家人"）。
 */
async function listReceived(db, actorId) {
  await assertFamilyShareOn(db);
  const mss = await db.collection(COLLECTIONS.ShareMembership)
    .find({ memberId: actorId, status: 'active' });
  const out = [];
  for (const ms of mss) {
    const owner = await db.collection(COLLECTIONS.User).findOne({ _id: ms.ownerId });
    out.push({ membershipId: ms._id, ownerId: ms.ownerId, owner: owner || null, createdAt: ms.createdAt });
  }
  return out;
}

/**
 * 我作为成员对某账本的授权（任务AD 切云新增）：与 data-service 原直连拼装
 * 同口径——无有效共享/无授权文档返回 null，有则返回 { switches, scope }。
 */
async function getMyGrantFor(db, actorId, ownerId) {
  const ms = await db.collection(COLLECTIONS.ShareMembership)
    .findOne({ ownerId, memberId: actorId, status: 'active' });
  if (!ms) return null;
  const grant = await db.collection(COLLECTIONS.ShareGrant)
    .findOne({ membershipId: ms._id });
  if (!grant) return null;
  return { switches: grant.switches || {}, scope: grant.scope || {} };
}

module.exports = { invite, accept, updateGrant, removeMember, listMembers, getGrant, getMembership, listReceived, getMyGrantFor, SWITCH_IDS, PENDING_TTL_MS, isPendingExpired, normalizeRemark };
