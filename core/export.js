/**
 * 礼单簿 · 导出数据筛选（阶段1补强）
 *
 * 服务端按授权范围筛选导出数据；实际 xlsx 文件生成为阶段3。
 * - 本人：可导出全部
 * - 成员：需 export 开关；只导出已授权范围（事件取交集，送礼看 scope.gifts）
 * - 读取/导出不信任调用方传入的 id，一律按授权单范围重新筛选
 */
const errors = require('./errors');

const { COLLECTIONS, now } = require('./models');
const authz = require('./authz');
const audit = require('./audit');

/**
 * 计算导出者对某账本的有效导出范围
 * @returns {{ok, reason?, events?: string[]|'all', gifts?: boolean}}
 */
async function checkExportScope(db, actorId, ownerId) {
  if (!actorId || !ownerId) return { ok: false, reason: 'empty-identity' };
  if (actorId === ownerId) return { ok: true, reason: 'owner', events: 'all', gifts: true };

  const pre = await authz.checkMemberAccess(db, actorId, ownerId);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  if (!pre.switches.view || !pre.switches.export) return { ok: false, reason: 'switch-off:export' };
  return {
    ok: true,
    reason: 'member',
    events: pre.scope.events,
    gifts: pre.scope.gifts,
  };
}

/**
 * 导出数据（筛选后返回，不含 xlsx 生成）
 * @param {object} opts {eventIds?: string[]|null, includeGifts?: boolean}
 *   eventIds 为 null 表示"已授权的全部事件"；传入则与授权范围取交集
 * @returns {{events, records, gifts}}
 * @throws 无权限导出:xxx
 */
async function exportData(db, actorId, ownerId, opts = {}) {
  const { eventIds = null, includeGifts = true } = opts;
  const sc = await checkExportScope(db, actorId, ownerId);
  if (!sc.ok) throw errors.permDenied(sc.reason);

  // 事件范围：本人=all；成员=授权events ∩ 请求events（请求为null则全授权）
  let eventIdsEff;
  if (sc.events === 'all') {
    eventIdsEff = eventIds; // null=全部
  } else {
    eventIdsEff = eventIds ? eventIds.filter((id) => sc.events.includes(id)) : [...sc.events];
  }

  const eventQuery = { ownerId };
  if (eventIdsEff) eventQuery._id = { $in: eventIdsEff };
  const events = await db.collection(COLLECTIONS.ReceiveEvent).find(eventQuery);

  const recQuery = { ownerId };
  if (eventIdsEff) recQuery.eventId = { $in: eventIdsEff };
  const records = await db.collection(COLLECTIONS.ReceiveRecord).find(recQuery);

  const giftsEff = sc.gifts === true || sc.gifts === 'all' ? includeGifts : false;
  const gifts = giftsEff ? await db.collection(COLLECTIONS.GiftRecord).find({ ownerId }) : [];

  await audit.log(db, {
    ownerId, actorId, action: 'export', targetType: 'export', targetId: '',
    detail: `导出：${events.length}个礼薄/${records.length}条收礼/${gifts.length}条送礼`,
  });

  return { events, records, gifts };
}

module.exports = { checkExportScope, exportData };
