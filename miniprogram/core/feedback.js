/**
 * 礼单簿 · 意见反馈（任务L）
 *
 * 用户端：pages/mine/feedback 提交（文字必填、截图可选最多 3 张占位）；
 * 老板平台：反馈列表读 feedbacks 集合，字段与 todo 骨架口径对齐——
 * 按时间列出反馈与处理状态（status: 'pending' 待处理 | 'handled' 已处理），
 * userId 对外一律脱敏（listFeedbackForAdmin），绝不带出账本内容。
 * 截图本轮只存占位（本地路径/待上传标记）；云联调后由页面先上传云存储，
 * 把 fileID 传进来即可，本层不感知来源。
 */
const { COLLECTIONS, now } = require('./models');
const AppConfig = require('../config/app-config');
const { maskUserId } = require('./admin-mask');

const MAX_IMAGES = 3;

function maxLength(config = AppConfig) {
  return (config.feedback && config.feedback.maxLength) || 500;
}

/**
 * 提交反馈
 * @param {{content:string, images?:string[]}} input
 * @returns {{feedbackId:string}}
 */
async function submitFeedback(db, userId, { content, images } = {}, config = AppConfig) {
  if (!userId) throw new Error('身份信息缺失，请重新登录');
  const text = String(content || '').trim();
  if (!text) throw new Error('反馈内容不能为空，先写下你想说的话吧');
  const max = maxLength(config);
  if (text.length > max) throw new Error(`反馈内容最多 ${max} 字，请删减后再提交`);
  const imgs = Array.isArray(images) ? images.filter(Boolean).slice(0, MAX_IMAGES) : [];
  const { _id } = await db.collection(COLLECTIONS.Feedback).insert({
    userId,
    content: text,
    images: imgs,
    status: 'pending',
    createdAt: now(),
  });
  return { feedbackId: _id };
}

/** 我提交过的反馈（最新在上，反馈页/后续状态查看用） */
async function listMyFeedback(db, userId, { limit = 20 } = {}) {
  return db.collection(COLLECTIONS.Feedback)
    .find({ userId }, { sort: { createdAt: -1 }, limit });
}

/**
 * 老板平台反馈列表：分页 + 可按处理状态过滤；userId 脱敏。
 * @returns {{total:number, items:Array}}
 */
async function listFeedbackForAdmin(db, { page = 1, pageSize = 20, status } = {}) {
  const query = status ? { status } : {};
  const all = await db.collection(COLLECTIONS.Feedback)
    .find(query, { sort: { createdAt: -1 } });
  const start = (Math.max(1, page) - 1) * pageSize;
  const items = all.slice(start, start + pageSize).map((f) => ({
    _id: f._id,
    userId: maskUserId(f.userId),
    content: f.content,
    images: f.images || [],
    status: f.status,
    createdAt: f.createdAt,
  }));
  return { total: all.length, items };
}

/** 老板平台标记处理状态（pending/handled 互切） */
async function setFeedbackStatus(db, feedbackId, status) {
  if (!['pending', 'handled'].includes(status)) throw new Error('反馈状态不正确');
  const r = await db.collection(COLLECTIONS.Feedback)
    .update({ _id: feedbackId }, { status });
  return { ok: (r.updated || 0) > 0 };
}

module.exports = { submitFeedback, listMyFeedback, listFeedbackForAdmin, setFeedbackStatus, maxLength, MAX_IMAGES };
