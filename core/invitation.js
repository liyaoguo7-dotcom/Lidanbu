/**
 * 礼单簿 · 电子请柬（阶段4）
 *
 * 规则口径：
 * - 建请柬是基础功能，不设会员门禁、不限额度（指令未设门禁，不得自创）。
 * - 回执不要求登录身份绑定：客人打开分享链接即可填；用 guestKey
 *   （当前用户的 openid，取不到时为前端生成的访客标识）尽力去重，
 *   同一 guestKey 重复提交 = 更新同一条回执，不新增。
 * - 主人权限：改/删/看回执统计仅限请柬主人（owner 校验）。
 * - 回执选「参加」的客人，主人可在统计页一键加入亲友录：走
 *   contacts.createContact 正规路径（createdBy=主人、额度/审计同普通
 *   新增），重名只提醒不合并；加完把 contactId 回填到回执上防重复加。
 * - 删除请柬连带删除其全部回执（永久删除，与全产品口径一致）。
 */
const errors = require('./errors');
const { COLLECTIONS, now } = require('./models');
const audit = require('./audit');
const restriction = require('./restriction');
const contacts = require('./contacts');
const { STYLES } = require('./invitation-styles');

/** 请柬类型（婚礼/满月/升学/乔迁/寿宴/其他） */
const TYPES = [
  { id: 'wedding', name: '婚礼' },
  { id: 'baby', name: '满月' },
  { id: 'school', name: '升学' },
  { id: 'housewarming', name: '乔迁' },
  { id: 'birthday', name: '寿宴' },
  { id: 'other', name: '其他' },
];

/** 回执出席选项 */
const ATTEND_OPTIONS = [
  { id: 'attend', name: '参加' },
  { id: 'absent', name: '不参加' },
  { id: 'undecided', name: '未定' },
];

function typeName(typeId) {
  const t = TYPES.find((x) => x.id === typeId);
  return t ? t.name : '其他';
}

function attendName(attendId) {
  const t = ATTEND_OPTIONS.find((x) => x.id === attendId);
  return t ? t.name : '未定';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 字段校验+清洗：建/改共用。返回只含白名单字段的对象。 */
function cleanFields(input = {}) {
  const out = {};
  if (input.type !== undefined) {
    if (!TYPES.some((t) => t.id === input.type)) throw new Error('请柬类型不正确');
    out.type = input.type;
  }
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('请柬标题不能为空');
    if (title.length > 60) throw new Error('请柬标题太长啦（最多 60 个字）');
    out.title = title;
  }
  if (input.eventDate !== undefined) {
    if (!DATE_RE.test(input.eventDate || '')) throw new Error('请选择活动日期');
    out.eventDate = input.eventDate;
  }
  if (input.eventTime !== undefined) {
    const t = String(input.eventTime || '').trim();
    if (t && !TIME_RE.test(t)) throw new Error('时间格式不正确');
    out.eventTime = t;
  }
  if (input.address !== undefined) {
    out.address = String(input.address || '').trim().slice(0, 120);
  }
  if (input.mapLoc !== undefined) {
    const m = input.mapLoc;
    if (!m || typeof m !== 'object') {
      out.mapLoc = null;
    } else {
      const lat = Number(m.latitude);
      const lng = Number(m.longitude);
      out.mapLoc = {
        name: String(m.name || '').trim().slice(0, 60),
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
      };
    }
  }
  if (input.hostName !== undefined) {
    const h = String(input.hostName || '').trim();
    if (!h) throw new Error('请填写主人姓名');
    out.hostName = h.slice(0, 30);
  }
  if (input.blessing !== undefined) {
    out.blessing = String(input.blessing || '').trim().slice(0, 200);
  }
  if (input.styleId !== undefined) {
    // 非法值回落第一种风格，不阻断保存
    out.styleId = STYLES.some((s) => s.id === input.styleId) ? input.styleId : 'guochao';
  }
  return out;
}

async function createInvitation(db, ownerId, fields) {
  await restriction.assertWritable(db, ownerId);
  if (!ownerId) throw errors.permDenied('empty-identity');
  const clean = cleanFields({
    type: 'wedding', eventTime: '', address: '', mapLoc: null, blessing: '', styleId: 'guochao',
    ...fields,
  });
  if (!clean.title) throw new Error('请柬标题不能为空');
  if (!clean.eventDate) throw new Error('请选择活动日期');
  if (!clean.hostName) throw new Error('请填写主人姓名');
  const doc = { ownerId, ...clean, createdAt: now() };
  const { _id } = await db.collection(COLLECTIONS.Invitation).insert(doc);
  await audit.log(db, { ownerId, actorId: ownerId, action: 'create', targetType: 'invitation', targetId: _id, detail: '新建电子请柬' });
  return { _id, ...doc };
}

async function getInvitation(db, invitationId) {
  if (!invitationId) return null;
  return db.collection(COLLECTIONS.Invitation).findOne({ _id: invitationId });
}

async function listInvitations(db, ownerId) {
  const list = await db.collection(COLLECTIONS.Invitation).find({ ownerId }, { sort: { createdAt: -1 } });
  // 附每份请柬的回执概况（主人列表一眼看清回复进度）
  const out = [];
  for (const inv of list) {
    const rsvps = await db.collection(COLLECTIONS.Rsvp).find({ invitationId: inv._id });
    const attendPeople = rsvps.filter((r) => r.attend === 'attend').reduce((s, r) => s + (r.count || 0), 0);
    out.push({ ...inv, rsvpCount: rsvps.length, attendPeople });
  }
  return out;
}

/** 取请柬并校验主人身份（改/删/统计共用） */
async function getOwned(db, actorId, invitationId) {
  const inv = await getInvitation(db, invitationId);
  if (!inv) throw new Error('请柬不存在');
  if (inv.ownerId !== actorId) throw errors.permDenied('invitation-not-owner');
  return inv;
}

async function updateInvitation(db, actorId, invitationId, patch) {
  await restriction.assertWritable(db, actorId);
  const inv = await getOwned(db, actorId, invitationId);
  const clean = cleanFields(patch || {});
  if (Object.keys(clean).length === 0) return inv;
  await db.collection(COLLECTIONS.Invitation).update({ _id: invitationId }, clean);
  await audit.log(db, { ownerId: inv.ownerId, actorId, action: 'update', targetType: 'invitation', targetId: invitationId, detail: '修改电子请柬' });
  return { ...inv, ...clean };
}

async function deleteInvitation(db, actorId, invitationId) {
  await restriction.assertWritable(db, actorId);
  const inv = await getOwned(db, actorId, invitationId);
  const r = await db.collection(COLLECTIONS.Rsvp).remove({ invitationId });
  await db.collection(COLLECTIONS.Invitation).remove({ _id: invitationId });
  await audit.log(db, {
    ownerId: inv.ownerId, actorId, action: 'delete', targetType: 'invitation', targetId: invitationId,
    detail: `删除电子请柬，连带回执${r.removed}条`,
  });
  return { removedRsvps: r.removed };
}

/**
 * 提交回执（客人侧，不要求是主人、不查会员）。
 * guestKey 尽力去重：带同一 guestKey 再次提交则更新原回执。
 */
async function submitRsvp(db, invitationId, { guestName, attend = 'attend', count, note = '', guestKey = '' } = {}) {
  const inv = await getInvitation(db, invitationId);
  if (!inv) throw new Error('请柬不存在');
  const name = String(guestName || '').trim();
  if (!name) throw new Error('请填写您的姓名');
  if (!ATTEND_OPTIONS.some((o) => o.id === attend)) throw new Error('请选择是否参加');
  let n = parseInt(count, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 50) n = 50;
  const finalCount = attend === 'attend' ? n : 0;
  const cleanNote = String(note || '').trim().slice(0, 100);
  const key = String(guestKey || '').trim();

  if (key) {
    const existing = await db.collection(COLLECTIONS.Rsvp)
      .findOne({ invitationId, guestKey: key });
    if (existing) {
      const patch = { guestName: name, attend, count: finalCount, note: cleanNote };
      await db.collection(COLLECTIONS.Rsvp).update({ _id: existing._id }, patch);
      return { _id: existing._id, updated: true, ...existing, ...patch };
    }
  }
  const doc = {
    invitationId, guestName: name, attend, count: finalCount, note: cleanNote,
    guestKey: key, contactId: null, createdAt: now(),
  };
  const { _id } = await db.collection(COLLECTIONS.Rsvp).insert(doc);
  return { _id, updated: false, ...doc };
}

/** 客人查自己提交过的回执（guest 页回填用） */
async function getMyRsvp(db, invitationId, guestKey) {
  if (!guestKey) return null;
  return db.collection(COLLECTIONS.Rsvp).findOne({ invitationId, guestKey: String(guestKey) });
}

async function listRsvps(db, actorId, invitationId) {
  await getOwned(db, actorId, invitationId);
  return db.collection(COLLECTIONS.Rsvp).find({ invitationId }, { sort: { createdAt: 1 } });
}

/**
 * 回执统计（主人）：参加人数合计（按 count 累加）、参加/不参加/未定组数，
 * 名单附亲友录关联状态（contactId 有值 = 已加入亲友录）。
 */
async function getRsvpStats(db, actorId, invitationId) {
  const inv = await getOwned(db, actorId, invitationId);
  const rsvps = await db.collection(COLLECTIONS.Rsvp).find({ invitationId }, { sort: { createdAt: 1 } });
  const stats = {
    invitation: inv,
    total: rsvps.length,
    attendParties: 0, attendPeople: 0, absentParties: 0, undecidedParties: 0,
    list: rsvps,
  };
  for (const r of rsvps) {
    if (r.attend === 'attend') { stats.attendParties += 1; stats.attendPeople += r.count || 0; }
    else if (r.attend === 'absent') stats.absentParties += 1;
    else stats.undecidedParties += 1;
  }
  return stats;
}

/**
 * 一键把回执客人加入亲友录（主人操作）。
 * 走 contacts.createContact 正规路径：额度校验、审计、重名只提醒全在里面。
 * 已加过（contactId 有值）则直接返回，不重复建。
 */
async function addRsvpGuestToContacts(db, actorId, invitationId, rsvpId) {
  const inv = await getOwned(db, actorId, invitationId);
  const rsvp = await db.collection(COLLECTIONS.Rsvp).findOne({ _id: rsvpId, invitationId });
  if (!rsvp) throw new Error('回执不存在');
  if (rsvp.contactId) return { contactId: rsvp.contactId, alreadyAdded: true, duplicateWarning: false };
  const created = await contacts.createContact(db, actorId, actorId, {
    name: rsvp.guestName,
    remark: `电子请柬回执 · ${inv.title}`,
  });
  await db.collection(COLLECTIONS.Rsvp).update({ _id: rsvpId }, { contactId: created._id });
  return { contactId: created._id, alreadyAdded: false, duplicateWarning: !!created.duplicateWarning };
}

module.exports = {
  TYPES, ATTEND_OPTIONS, typeName, attendName,
  createInvitation, getInvitation, listInvitations,
  updateInvitation, deleteInvitation,
  submitRsvp, getMyRsvp, listRsvps, getRsvpStats, addRsvpGuestToContacts,
};
