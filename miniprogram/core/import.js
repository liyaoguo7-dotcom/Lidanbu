/**
 * 礼单簿 · 拍照导入写入（阶段4，本轮改整批原子）
 *
 * 确认写入的唯一入口：validateTarget + writeImport。
 * - 收礼必须先选定礼薄（未选抛错，页面不得进拍照）。
 * - **整批原子**：先全批校验（逐条：姓名/亲友、金额；再整批：额度容量），
 *   任一条不合格 → 整批不写，返回 rawError 并带 itemIndex（0 起）定位到
 *   出问题的那一条（页面据此高亮滚动定位）。全部校验通过后才逐条落库。
 * - 额度在写入前按整批拦截：本批条数超过剩余额度容量即整批拒绝，
 *   rawError 为 quotaDenied（卖惨文案由 data-service.friendly 透出），
 *   不出现部分写入。
 * 纯 JS，无微信依赖。
 */
const gifts = require('./gifts');
const receive = require('./receive');
const quota = require('./quota');
const errors = require('./errors');
const restriction = require('./restriction');
const { COLLECTIONS } = require('./models');
const AppConfig = require('../config/app-config');

function _today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function _fail(message, itemIndex, code) {
  const e = new Error(message);
  if (code) e.code = code;
  if (Number.isInteger(itemIndex)) e.itemIndex = itemIndex;
  return e;
}

/**
 * 校验导入目标；收礼未选礼薄直接抛错（页面据此拦截进拍照）。
 */
function validateTarget(kind, eventId) {
  if (kind !== 'gift' && kind !== 'receive') {
    throw new Error('导入类型必须为送礼或收礼');
  }
  if (kind === 'receive' && !eventId) {
    throw new Error('请先新建或选择一个礼薄');
  }
}

/**
 * 整批额度容量（还能再写多少条）。与 quota.checkAddQuota 同一口径：
 * 送礼 = 生效额度总数 - 已用；收礼 = 本礼薄剩余额度 + 额度池剩余。
 * @returns { capacity, quotaReason } quotaReason 为容量不足时的原因码
 */
async function _batchCapacity(db, ownerId, kind, eventId) {
  const user = await db.collection(COLLECTIONS.User).findOne({ _id: ownerId });
  if (!user) throw new Error('账本主人不存在');
  const successfulInvites = await quota.countSuccessfulInvites(db, ownerId);
  const settings = await quota.resolveInviteSettings(db, AppConfig);
  const q = quota.getEffectiveQuota(user, AppConfig, Date.now(), { successfulInvites, settings });
  if (kind === 'gift') {
    const used = await db.collection(COLLECTIONS.GiftRecord).count({ ownerId });
    return { capacity: Math.max(0, q.giftRecords - used), quotaReason: 'quota-exceeded:gift' };
  }
  const inEvent = await db.collection(COLLECTIONS.ReceiveRecord).count({ ownerId, eventId });
  const inEventFree = Math.max(0, q.recordsPerEvent - inEvent);
  const poolUsed = await quota.computePoolUsed(db, ownerId, q.recordsPerEvent);
  const poolFree = Math.max(0, (q.receivePool || 0) - poolUsed);
  const quotaReason = inEventFree > 0 || poolFree > 0
    ? 'quota-exceeded:receivePool'
    : 'quota-exceeded:receiveRecord';
  return { capacity: inEventFree + poolFree, quotaReason };
}

/**
 * 把识别结果整批写入账本（原子：先全批校验，任一条不合格整批不写）。
 * @param items 每条 { name?, contactId, amountFen, note?, tagId?, type?, date? }
 *   收礼 type 缺省「现金」；送礼 tagId 缺省 'qita'；date 缺省今天。
 * @returns { written, total, rawError }
 *   全成功 rawError=null；校验失败 written=0 且 rawError.itemIndex 定位条目；
 *   落库阶段的意外错误（校验已过，理论不应发生）保留 written 计数如实返回。
 */
/**
 * 记录一次导入用量（老板平台第4项「拍照导入用量」的数据源）。
 * 只记条数级信息：谁、何时、送礼还是收礼、成功/失败、失败大类、条数；
 * 绝不记姓名、金额、备注等账本内容。记录失败不影响导入主流程。
 * status: 'success' | 'failed' | 'partial'（部分落库）
 * failReason: 'quota'（额度拦截） | 'validation'（逐条校验） | 'write-error'（落库异常） | null
 */
async function _recordImportJob(db, ownerId, kind, eventId, result) {
  try {
    let status = 'success';
    let failReason = null;
    if (result.rawError) {
      status = result.written > 0 ? 'partial' : 'failed';
      const code = result.rawError.code || '';
      failReason = code.startsWith('quota-exceeded') ? 'quota'
        : status === 'partial' ? 'write-error' : 'validation';
    }
    await db.collection(COLLECTIONS.ImportJob).insert({
      ownerId, kind, eventId: eventId || null,
      status, failReason, itemCount: result.total,
      createdAt: Date.now(),
    });
  } catch (e) { /* 用量记录失败不拦导入 */ }
}

async function writeImport(db, actorId, ownerId, args) {
  const result = await _writeImportInner(db, actorId, ownerId, args);
  await _recordImportJob(db, ownerId, args.kind, args.eventId, result);
  return result;
}

async function _writeImportInner(db, actorId, ownerId, { kind, eventId, items }) {
  await restriction.assertWritable(db, actorId);
  validateTarget(kind, eventId);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('没有可写入的记录');
  }
  const total = items.length;
  const reject = (rawError) => ({ written: 0, total, rawError });

  /* —— 第一阶段：逐条校验（姓名/亲友存在、金额合法） —— */
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const label = `第${i + 1}条`;
    if (!it.contactId) {
      return reject(_fail(`「${it.name || label}」还不是亲友，请先建亲友`, i));
    }
    const contact = await db.collection(COLLECTIONS.Contact)
      .findOne({ _id: it.contactId, ownerId });
    if (!contact) {
      return reject(_fail(`${label}选的亲友找不到了，请重新选一下`, i));
    }
    if (!Number.isInteger(it.amountFen) || it.amountFen <= 0) {
      return reject(_fail(`「${it.name || contact.name || label}」的金额不正确`, i));
    }
  }

  /* —— 第二阶段：整批额度校验（不够整批拦截，不部分写入） —— */
  const { capacity, quotaReason } = await _batchCapacity(db, ownerId, kind, eventId);
  if (total > capacity) {
    const e = errors.quotaDenied(quotaReason);
    e.itemIndex = capacity; // 第 capacity+1 条是第一条放不下的
    return reject(e);
  }

  /* —— 第三阶段：逐条落库（校验已全过） —— */
  const date = _today();
  let written = 0;
  for (const it of items) {
    try {
      if (kind === 'gift') {
        await gifts.createGift(db, actorId, ownerId, {
          contactId: it.contactId,
          tagId: it.tagId || 'qita',
          amount: it.amountFen,
          remark: it.note || '',
          date: it.date || date,
        });
      } else {
        await receive.createRecord(db, actorId, ownerId, eventId, {
          contactId: it.contactId,
          amount: it.amountFen,
          type: it.type || '现金',
          remark: it.note || '',
          date: it.date || date,
        });
      }
      written += 1;
    } catch (e) {
      // 校验后仍失败（如并发抢额度）：如实报告已写条数，不假装原子回滚
      if (!Number.isInteger(e.itemIndex)) e.itemIndex = written;
      return { written, total, rawError: e };
    }
  }
  return { written, total, rawError: null };
}

module.exports = { validateTarget, writeImport };
