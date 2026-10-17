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

module.exports = { resolveRange, getWanglaiStats, getContactTimeline, visibleRecords };
