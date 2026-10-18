/**
 * 礼单簿 · 往来统计与时间线（T1.4）
 * v3.1 §5、§14.2：
 * - 时间范围：今日/本月/今年/近一年/自定义（起止日期）
 * - 个人往来时间线：最早在上（刻意区别于列表的最新在上）
 * - 成员视角：只用已授权给他的数据计算（总额、笔数、差额）
 * - 差额 = 收到总额 - 送出总额，不加符号
 */

const { COLLECTIONS } = require('./models');
const authz = require('./authz');
const errors = require('./errors');
const AppConfig = require('../config/app-config');

const TAG_NAME = new Map((AppConfig.tags || []).map((t) => [t.id, t.name]));
function tagNameOf(tagId) {
  return TAG_NAME.get(tagId) || tagId || '';
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 时间范围预设 → {from, to}（YYYY-MM-DD） */
function resolveRange(preset, customFrom, customTo) {
  const t = new Date();
  const todayS = fmtDate(t);
  if (preset === 'today') return { from: todayS, to: todayS };
  if (preset === 'month') return { from: todayS.slice(0, 7) + '-01', to: todayS };
  if (preset === 'year') return { from: todayS.slice(0, 4) + '-01-01', to: todayS };
  if (preset === 'lastYear') {
    const p = new Date(t.getTime() - 365 * 86400e3);
    return { from: fmtDate(p), to: todayS };
  }
  if (preset === 'custom') {
    if (!customFrom || !customTo) throw new Error('自定义范围需起止日期');
    return { from: customFrom, to: customTo };
  }
  throw new Error(`未知时间范围:${preset}`);
}

/** 取查看者可见的记录（成员只含授权数据） */
async function visibleRecords(db, viewerId, ownerId) {
  if (viewerId === ownerId) {
    const receives = await db.collection(COLLECTIONS.ReceiveRecord).find({ ownerId });
    const gifts = await db.collection(COLLECTIONS.GiftRecord).find({ ownerId });
    return { receives, gifts, isMember: false };
  }
  const pre = await authz.checkMemberAccess(db, viewerId, ownerId);
  if (!pre.ok || !pre.switches.view) return { receives: [], gifts: [], isMember: true };
  const scope = pre.scope;
  const receives = scope.events.length
    ? await db.collection(COLLECTIONS.ReceiveRecord).find({ ownerId, eventId: { $in: scope.events } })
    : [];
  const gifts = scope.gifts
    ? await db.collection(COLLECTIONS.GiftRecord).find({ ownerId })
    : [];
  return { receives, gifts, isMember: true };
}

/**
 * 全局往来统计（Tab2）
 * @returns {{receiveTotal, receiveCount, giftTotal, giftCount, diff, isMember}}
 * 金额单位：分
 */
async function getWanglaiStats(db, viewerId, ownerId, { preset = 'lastYear', from, to } = {}) {
  const range = resolveRange(preset, from, to);
  const { receives, gifts, isMember } = await visibleRecords(db, viewerId, ownerId);
  const inRange = (r) => r.date >= range.from && r.date <= range.to;
  const rs = receives.filter(inRange);
  const gs = gifts.filter(inRange);
  const receiveTotal = rs.reduce((s, r) => s + r.amount, 0);
  const giftTotal = gs.reduce((s, r) => s + r.amount, 0);
  return {
    receiveTotal, receiveCount: rs.length,
    giftTotal, giftCount: gs.length,
    diff: receiveTotal - giftTotal, // 差额=收到-送出，不加符号
    from: range.from, to: range.to,
    isMember, // 成员版页面顶部显示"仅统计已授权给你的记录"
  };
}

/**
 * 个人往来时间线（竖线树数据源）
 * 左送出右收到靠紧竖线；按时间从早到晚（最早在上）；金额分转元由前端做
 * @returns {[{date, direction:'out'|'in', amount, type, eventName?, remark}]}
 */
async function getContactTimeline(db, viewerId, ownerId, contactId) {
  // 联系人可见性先校验
  const ck = await authz.check(db, viewerId, 'read', { kind: 'contact', ownerId, contactId });
  if (!ck.ok) throw new Error(`无权限查看该联系人往来:${ck.reason}`);

  const { receives, gifts } = await visibleRecords(db, viewerId, ownerId);
  const items = [];
  const events = new Map();
  if (receives.length) {
    const evs = await db.collection(COLLECTIONS.ReceiveEvent).find({ ownerId });
    evs.forEach((e) => events.set(e._id, e));
  }
  receives.filter((r) => r.contactId === contactId).forEach((r) => {
    items.push({
      date: r.date, direction: 'in', amount: r.amount,
      type: r.type, eventName: (events.get(r.eventId) || {}).name || '',
      remark: r.remark, recordId: r._id, kind: 'receiveRecord',
    });
  });
  gifts.filter((r) => r.contactId === contactId).forEach((r) => {
    items.push({
      date: r.date, direction: 'out', amount: r.amount,
      type: r.type || '', eventName: '', remark: r.remark, recordId: r._id, kind: 'giftRecord',
    });
  });
  // 最早在上
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const inTotal = items.filter((i) => i.direction === 'in').reduce((s, i) => s + i.amount, 0);
  const outTotal = items.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amount, 0);
  return { items, inTotal, outTotal, diff: inTotal - outTotal };
}

module.exports = {
  resolveRange, resolveRangeOpt,
  getWanglaiStats, getContactTimeline, visibleRecords,
  contactStats, timeline, memberStats, memberTimeline, findContactsByName,
};

/**
 * 成员视角的竖线树（只含已授权给 actorId 的记录）
 * - 主人视角：等价于 timeline()，isMember:false
 * - 成员：收礼只含授权事件，送礼看 scope.gifts；无权限抛 errors.permDenied
 * @returns 同 timeline，另带 isMember
 */
async function memberTimeline(db, actorId, ownerId, contactId, opts = {}) {
  const stats = await memberStats(db, actorId, ownerId, contactId, opts);
  const full = await timeline(db, ownerId, contactId, opts);
  if (!stats.isMember) return { ...full, isMember: false };
  const pre = await authz.checkMemberAccess(db, actorId, ownerId);
  const eventIds = (pre.ok && pre.scope.events) || [];
  const giftsOk = !!(pre.ok && pre.scope.gifts);
  const items = full.items.filter((it) => (
    it.type === 'receive' ? eventIds.includes(it.eventId) : giftsOk
  ));
  return { ...stats, items, isMember: true };
}

/**
 * 时间范围参数归一化（2B 往来页/竖线树）
 * @param {string|{start,end}} range 'today'|'month'|'year'|'lastYear' 或 {start,end}
 *   自定义起止为 YYYY-MM-DD，含起止当天；缺省='lastYear'
 * @returns {{from, to}} YYYY-MM-DD
 */
function resolveRangeOpt(range) {
  if (!range) return resolveRange('lastYear');
  if (typeof range === 'string') return resolveRange(range);
  if (typeof range === 'object') {
    const { start, end } = range;
    const ok = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!ok(start) || !ok(end)) throw new Error('自定义范围起止日期须为 YYYY-MM-DD');
    if (start > end) throw new Error('自定义范围起始日期不能晚于结束日期');
    return { from: start, to: end };
  }
  throw new Error('未知时间范围');
}

function sumFen(records) {
  return records.reduce((s, r) => s + r.amount, 0);
}

/**
 * 联系人往来统计（账本主人视角）
 * @returns {{receiveTotalFen, receiveCount, giftTotalFen, giftCount, diffFen, from, to}}
 * 笔数=明细条数；金额实时求和；金额单位"分"，显示层用 formatAmount 格式化
 */
async function contactStats(db, ownerId, contactId, opts = {}) {
  const range = resolveRangeOpt(opts.range);
  const inRange = (r) => r.date >= range.from && r.date <= range.to;
  const rs = (await db.collection(COLLECTIONS.ReceiveRecord).find({ ownerId, contactId })).filter(inRange);
  const gs = (await db.collection(COLLECTIONS.GiftRecord).find({ ownerId, contactId })).filter(inRange);
  const receiveTotalFen = sumFen(rs);
  const giftTotalFen = sumFen(gs);
  return {
    receiveTotalFen, receiveCount: rs.length,
    giftTotalFen, giftCount: gs.length,
    diffFen: receiveTotalFen - giftTotalFen, // 差额=收到-送出，可为负
    from: range.from, to: range.to,
  };
}

/**
 * 联系人往来竖线树数据源（最早在上）
 * @returns {{items, receiveTotalFen, receiveCount, giftTotalFen, giftCount, diffFen, from, to}}
 * items 每条 {type:'receive'|'gift', date, amountFen, tagId, tagName, eventName, note,
 *   payType(收礼才有), recordId, kind}，按 date 从早到晚（同日按创建时间）
 */
async function timeline(db, ownerId, contactId, opts = {}) {
  const range = resolveRangeOpt(opts.range);
  const inRange = (r) => r.date >= range.from && r.date <= range.to;
  const receives = (await db.collection(COLLECTIONS.ReceiveRecord).find({ ownerId, contactId })).filter(inRange);
  const gifts = (await db.collection(COLLECTIONS.GiftRecord).find({ ownerId, contactId })).filter(inRange);
  const events = new Map();
  if (receives.length) {
    const evs = await db.collection(COLLECTIONS.ReceiveEvent).find({ ownerId });
    evs.forEach((e) => events.set(e._id, e));
  }
  const items = [];
  receives.forEach((r) => {
    const ev = events.get(r.eventId) || {};
    items.push({
      type: 'receive', date: r.date, amountFen: r.amount,
      tagId: ev.tagId || '', tagName: tagNameOf(ev.tagId),
      eventName: ev.name || '', eventId: r.eventId || '', note: r.remark || '',
      payType: r.type || '', recordId: r._id, kind: 'receiveRecord',
      createdAt: r.createdAt || 0,
    });
  });
  gifts.forEach((g) => {
    items.push({
      type: 'gift', date: g.date, amountFen: g.amount,
      tagId: g.tagId || '', tagName: tagNameOf(g.tagId),
      eventName: '', note: g.remark || '',
      payType: '', recordId: g._id, kind: 'giftRecord',
      createdAt: g.createdAt || 0,
    });
  });
  items.sort((a, b) => (
    a.date < b.date ? -1 : a.date > b.date ? 1
      : a.createdAt - b.createdAt || String(a.recordId).localeCompare(String(b.recordId))
  ));
  const receiveTotalFen = sumFen(receives);
  const giftTotalFen = sumFen(gifts);
  return {
    items: items.map(({ createdAt, ...rest }) => rest),
    receiveTotalFen, receiveCount: receives.length,
    giftTotalFen, giftCount: gifts.length,
    diffFen: receiveTotalFen - giftTotalFen,
    from: range.from, to: range.to,
  };
}

/**
 * 成员视角的联系人往来统计（只用已授权给 actorId 的数据）
 * - 无有效授权 / 无查看开关 → 抛 errors.permDenied
 * - 联系人不在授权记录里出现过 → 抛 errors.permDenied（out-of-scope:contact）
 * - 收礼只含授权事件；送礼看 scope.gifts
 * @returns 同 contactStats，另带 isMember:true
 */
async function memberStats(db, actorId, ownerId, contactId, opts = {}) {
  let eventIds = null; // null=全部事件（账本主人）
  let giftsOk = true;
  const isOwner = actorId === ownerId;
  if (!isOwner) {
    const pre = await authz.checkMemberAccess(db, actorId, ownerId);
    if (!pre.ok) throw errors.permDenied(pre.reason);
    if (!pre.switches.view) throw errors.permDenied('switch-off:view');
    eventIds = pre.scope.events;
    giftsOk = pre.scope.gifts;
  }
  // 联系人可见性：只统计授权记录里出现过的联系人（第19章#3建议）
  const ck = await authz.check(db, actorId, 'read', { kind: 'contact', ownerId, contactId });
  if (!ck.ok) throw errors.permDenied(ck.reason);

  const range = resolveRangeOpt(opts.range);
  const inRange = (r) => r.date >= range.from && r.date <= range.to;
  const rq = { ownerId, contactId };
  if (eventIds) rq.eventId = { $in: eventIds };
  const rs = (await db.collection(COLLECTIONS.ReceiveRecord).find(rq)).filter(inRange);
  const gs = giftsOk
    ? (await db.collection(COLLECTIONS.GiftRecord).find({ ownerId, contactId })).filter(inRange)
    : [];
  const receiveTotalFen = sumFen(rs);
  const giftTotalFen = sumFen(gs);
  return {
    receiveTotalFen, receiveCount: rs.length,
    giftTotalFen, giftCount: gs.length,
    diffFen: receiveTotalFen - giftTotalFen,
    from: range.from, to: range.to,
    isMember: !isOwner, // 成员版页面顶部显示"仅统计已授权给你的记录"
  };
}

/**
 * 按姓名找联系人（往来页搜索用）
 * 模糊匹配：姓名或备注包含关键字（不区分大小写）；空关键字返回 []
 */
async function findContactsByName(db, ownerId, name) {
  const kw = String(name || '').trim().toLowerCase();
  if (!kw) return [];
  const all = await db.collection(COLLECTIONS.Contact).find({ ownerId });
  return all.filter((c) => (
    (c.name && c.name.toLowerCase().includes(kw)) ||
    (c.remark && c.remark.toLowerCase().includes(kw))
  ));
}
