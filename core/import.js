/**
 * 礼单簿 · 拍照导入写入（阶段4）
 *
 * 确认写入的唯一入口：validateTarget + writeImport。
 * - 收礼必须先选定礼薄（未选抛错，页面不得进拍照）。
 * - 逐条写入，遇到第一条失败即停，返回已写入条数与原始错误；
 *   调用方（data-service）把 rawError 转成用户可读文案。
 * - 额度类错误由 gifts/receive 抛 quotaDenied（卖惨文案），失败条目不落库。
 * 纯 JS，无微信依赖。
 */
const gifts = require('./gifts');
const receive = require('./receive');

function _today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
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
 * 把识别结果逐条写入账本。
 * @param items 每条 { contactId, amountFen, note?, tagId?, date? }
 * @returns { written, total, rawError } rawError 为 null 表示全部成功
 */
async function writeImport(db, actorId, ownerId, { kind, eventId, items }) {
  validateTarget(kind, eventId);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('没有可写入的记录');
  }
  const date = _today();
  let written = 0;
  for (const it of items) {
    try {
      if (!it.contactId) {
        throw new Error(`「${it.name || '未知姓名'}」还不是亲友，请先建亲友`);
      }
      if (!Number.isInteger(it.amountFen) || it.amountFen <= 0) {
        throw new Error(`「${it.name || ''}」的金额不正确`);
      }
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
          type: '现金', // 导入默认现金，详情页可改
          remark: it.note || '',
          date: it.date || date,
        });
      }
      written += 1;
    } catch (e) {
      return { written, total: items.length, rawError: e };
    }
  }
  return { written, total: items.length, rawError: null };
}

module.exports = { validateTarget, writeImport };
