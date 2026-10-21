/**
 * 礼单簿 · 拍照导入（阶段4 写入整批原子；2026-10-21 接积分门禁）
 *
 * 任务流（startImportTask → writeImport），顺序铁律：会员 → 积分 → 识别 → 写入。
 * - 会员门禁：拍照录入是会员专属（memberOnlyFeatures 含 photoImport），
 *   非会员在识别前就被 memberRequired 拦下，不查积分、不调识别。
 * - 隐私同意**不是门禁**（2026-10-21 用户纠正口径）：同意状态只做记录与
 *   展示（首次打开由页面层弹窗、"我的—隐私"可查），**不拦截拍照导入
 *   或任何其他功能**，本任务流不查 privacyConsent。
 * - 积分预检：识别前先查余额 < 单价（AppConfig.points.photoImportCost，
 *   老板平台可覆盖）→ 直接抛 insufficient-points（委婉文案），
 *   不产生任务、不调识别、不扣款。
 * - 扣费时机与语义（本轮二选一已定）：**识别成功产出结果后才扣费**。
 *   以 refId='import:'+jobId 调 points.spend（kind='photo_import'），
 *   spend 本身按 refId 幂等——同一 job 重复走完整流程只扣一次。
 *   识别失败 = 还没扣，天然"失败不扣"，不需要返还路径。
 * - 额度拦截返还：writeImport 整批被额度拦截（quota-exceeded）时，
 *   按同一 refId 调 points.refund 全额返还该任务已扣积分（refund 幂等，
 *   只退一次；没扣过则跳过）。其他校验失败不退（识别已成功、费用已发生，
 *   用户改好条目可重新整批写入，同一 job 不会再扣）。
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
const ocr = require('./ocr-adapter');
const points = require('./points');
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

function _newJobId() {
  return `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 开始一次拍照导入任务：会员门禁 → 积分预检 → 识别 → 识别成功后扣费。
 * 一个任务（一个 jobId）只扣一次：重复以同一 jobId 走完整流程时，
 * points.spend 按 refId 幂等返回首次扣费结果，不重复扣。
 * @param opts { jobId?, kind, eventId?, imagePath, provider?, fail? }
 *   jobId 由页面生成并随待确认数据暂存（重试同一任务时复用）；
 *   缺省在此生成。fail 仅供演示/测试触发 MockOCR 失败态。
 * @returns { jobId, items, cost, duplicated }
 *   cost 为本次任务单价（积分）；duplicated=true 表示该 job 此前已扣过费。
 * @throws memberRequired（非会员）| pointsDenied insufficient-points（余额不足，
 *   识别前拦截，无扣款）| OCR 识别错误（未扣款）
 */
async function startImportTask(db, actorId, ownerId, { jobId, kind, eventId, imagePath, provider, fail } = {}) {
  await restriction.assertWritable(db, actorId);
  validateTarget(kind, eventId);

  /* —— 第一关：会员门禁（与导入页现行口径一致：member / grace 可用） —— */
  const owner = await db.collection(COLLECTIONS.User).findOne({ _id: ownerId });
  if (!owner) throw new Error('账本主人不存在');
  const state = quota.getMembershipState(owner, AppConfig);
  if (state !== 'member' && state !== 'grace') {
    throw errors.memberRequired('拍照导入');
  }

  /* —— 第二关：积分预检（余额 < 单价直接拦下，不识别、不扣款） —— */
  const settings = await points.resolvePointsSettings(db, AppConfig);
  const cost = settings.photoImportCost;
  if (cost > 0) {
    const balance = await points.getBalance(db, ownerId);
    if (balance < cost) throw errors.pointsDenied('insufficient-points');
  }

  /* —— 第三关：识别（失败抛错，此时尚未扣费，天然不扣） —— */
  const items = await ocr.recognize(imagePath, { kind, provider, fail });

  /* —— 识别成功 → 扣费（refId 绑定 job，幂等只扣一次） —— */
  const id = jobId || _newJobId();
  let duplicated = false;
  if (cost > 0) {
    const r = await points.spend(db, ownerId, cost, {
      kind: 'photo_import',
      refId: `import:${id}`,
      note: '拍照录入',
    });
    duplicated = !!r.duplicated;
  }
  return { jobId: id, items, cost, duplicated };
}

/**
 * 额度拦截时的积分返还：按 job 的原始扣费流水全额退（金额以原扣为准，
 * 不读现行配置，避免中途改价退错数）。points.refund 幂等——重复调用
 * 只退一次；该 job 没扣过费（单价为 0 / 识别前被拦）时静默跳过。
 * 返还本身失败不影响导入结果的如实返回（流水可事后对账）。
 */
async function _refundImportCharge(db, ownerId, jobId) {
  if (!jobId) return;
  try {
    const refId = `import:${jobId}`;
    const entries = await db.collection(COLLECTIONS.PointsLedger)
      .find({ userId: ownerId, kind: 'photo_import', refId });
    const spent = (entries || []).find((e) => e.delta < 0);
    if (!spent) return;
    await points.refund(db, ownerId, -spent.delta, { refId, note: '导入被额度拦截，自动返还' });
  } catch (e) { /* 返还失败不拦导入结果返回；points.refund 幂等可重试 */ }
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
  // 整批被额度拦截 → 该任务已扣的积分全额自动返还（只退一次；
  // 其他失败不退：识别已成功、费用已发生，改好条目可用同一 job 重写）
  if (result.rawError && args.jobId
    && String(result.rawError.code || '').startsWith('quota-exceeded')) {
    await _refundImportCharge(db, ownerId, args.jobId);
  }
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

module.exports = { validateTarget, writeImport, startImportTask };
