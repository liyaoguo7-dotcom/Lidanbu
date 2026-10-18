/**
 * 礼单簿 · 数据服务层（阶段2 2A）
 *
 * 页面只调这一层，不直接碰 core/ 也不直接碰存储。
 * 开发期用微信本地存储（WxStorageDB）演示；云环境就绪后把 _makeDb()
 * 换成 CloudDB，页面代码不动。本地模式开关见 AppConfig.demo.localMode。
 *
 * 所有业务规则（额度、权限、会员状态）都在 core/ 里实现，这里只做
 * 参数组装与错误转用户可读文案。
 */
const core = require('../core/index.js');
const AppConfig = require('../config/app-config.js');
const { tagIconPath } = require('../config/tag-icons.js');
const { WxStorageDB } = require('./db-wxstorage.js');

const USER_KEY = 'lidanbu_demo_user';
const SEEDED_KEY = 'lidanbu_demo_seeded_v1';

let _db = null;
let _userId = null;

function _makeDb() {
  // —— 本地/云切换点（只改这里，页面代码不动）——
  // 本地演示模式：return new WxStorageDB();（当前）
  // 云模式：return new core.db.CloudDB();
  //   切云的前提（缺一不可，见 docs/云环境切换步骤.md）：
  //   1) miniprogram/app.js 填好 globalData.cloudEnvId 并取消 wx.cloud.init 注释；
  //   2) AppConfig.demo.localMode 设为 false；
  //   3) core/db-cloud.js 骨架已补全并联调通过；
  //   4) cloudfunctions/api 已部署。
  // 注意：WxStorageDB 与 CloudDB 同接口（collection/insert/find/findOne/count/update/remove），
  // core/ 业务层不感知底层是本地还是云，所以切换后页面层零改动。
  return new WxStorageDB();
}

function friendly(err) {
  if (!err) return '操作失败，请重试';
  const msg = err.message || String(err);
  // core 抛出的已是用户可读文案（errors.js），直接透出；兜底未知错误
  // 卖惨文案以"呜呜"开头，也须透出（此前会被吞成"操作失败"，已修复）
  if (/^无权限|需要开通会员|额度|已达上限|不存在|重复|不能为空|必须|呜呜/.test(msg)) return msg;
  return '操作失败，请重试';
}

async function ensureUser() {
  const col = _db.collection(core.models.COLLECTIONS.User);
  let user = await col.findOne({ _id: _userId });
  if (!user) {
    _userId = _userId || `demo_${Date.now()}`;
    user = {
      _id: _userId,
      nickname: '我',
      createdAt: Date.now(),
      membership: { status: 'free', expireAt: null },
    };
    await col.insert(user);
    try { wx.setStorageSync(USER_KEY, _userId); } catch (e) { /* ignore */ }
  }
  return user;
}

async function seedDemo() {
  let seeded = false;
  try { seeded = !!wx.getStorageSync(SEEDED_KEY); } catch (e) { /* ignore */ }
  if (seeded) return;
  // 演示种子：2 个联系人（亲友录/选择亲友有内容看）；不送礼记录（保留空状态演示）
  try {
    await core.contacts.createContact(_db, _userId, _userId, { name: '张三', remark: '同学' });
    await core.contacts.createContact(_db, _userId, _userId, { name: '李五', remark: '邻居' });
  } catch (e) { /* 已存在则跳过 */ }
  try { wx.setStorageSync(SEEDED_KEY, true); } catch (e) { /* ignore */ }
}

const service = {
  /** 应用启动时调用一次 */
  async init() {
    if (_db) return;
    _db = _makeDb();
    try {
      const saved = wx.getStorageSync(USER_KEY);
      if (saved) _userId = saved;
    } catch (e) { /* ignore */ }
    await ensureUser();
    await seedDemo();
  },

  get userId() { return _userId; },
  get localMode() { return !!(AppConfig.demo && AppConfig.demo.localMode); },

  // —— 联系人 ——
  async listContacts() {
    return core.contacts.listContacts(_db, _userId, _userId);
  },
  async searchContacts(keyword) {
    return core.contacts.searchContacts(_db, _userId, _userId, keyword);
  },
  async createContact({ name, remark }) {
    try {
      return await core.contacts.createContact(_db, _userId, _userId, { name, remark });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateContact(contactId, { name, remark }) {
    try {
      return await core.contacts.updateContact(_db, _userId, _userId, contactId, { name, remark });
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 两步删除：先返回影响条数，确认后再传 confirmed=true 真删 */
  async deleteContact(contactId, confirmed = false) {
    try {
      return await core.contacts.deleteContact(_db, _userId, _userId, contactId, confirmed);
    } catch (e) { throw new Error(friendly(e)); }
  },

  // —— 送礼 ——
  async listGifts() {
    const list = await core.gifts.listGifts(_db, _userId, _userId);
    // 最新在上
    return list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  async createGift({ contactId, tagId, amountFen, remark, date }) {
    try {
      return await core.gifts.createGift(_db, _userId, _userId, {
        contactId, tagId, amount: amountFen, remark, date,
      });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateGift(giftId, patch) {
    try {
      return await core.gifts.updateGift(_db, _userId, _userId, giftId, patch);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async deleteGift(giftId) {
    try {
      return await core.gifts.deleteGift(_db, _userId, _userId, giftId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getGift(giftId) {
    const col = _db.collection(core.models.COLLECTIONS.GiftRecord);
    return col.findOne({ _id: giftId, ownerId: _userId });
  },

  // —— 标签/配置 ——
  getTags() { return AppConfig.tags; },
  getTagById(id) { return AppConfig.tags.find((t) => t.id === id); },
  getDefaultTagId() { return AppConfig.defaultTagId; },
  /** 收礼类型：红包/现金/转账/微信/支付宝 */
  getRecordTypes() { return AppConfig.recordTypes || ['红包', '现金', '转账', '微信', '支付宝']; },
  /** 标签图案：唯一映射，换文件即换图案（见 config/tag-icons.js） */
  tagIcon(tagId) {
    return tagIconPath(tagId);
  },

  // —— 会员/额度 ——
  async getMembership() {
    const col = _db.collection(core.models.COLLECTIONS.User);
    const user = await col.findOne({ _id: _userId });
    return {
      state: core.quota.getMembershipState(user),
      quota: core.quota.getEffectiveQuota(user),
    };
  },

  // —— 拍照导入（阶段4；OCR 厂商未拍板，本轮只走 MockOCR） ——
  /** 识别照片 → [{ name, amountFen, note, raw }]（可编辑） */
  async recognizePhoto(imagePath, kind) {
    try {
      return await core.ocr.recognize(imagePath, { kind });
    } catch (e) {
      throw new Error(friendly(e));
    }
  },
  // —— 收礼礼薄（事件）——
  /** 收礼礼薄列表（导入前先选） */
  async listEvents() {
    return core.receive.listEvents(_db, _userId, _userId);
  },
  async createEvent({ name, tagId, date, remark }) {
    try {
      return await core.receive.createEvent(_db, _userId, _userId, { name, tagId, date, remark });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateEvent(eventId, patch) {
    try {
      return await core.receive.updateEvent(_db, _userId, _userId, eventId, patch);
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 删除礼薄：返回 {removedRecords}（连带删除的明细条数），供弹窗展示 */
  async deleteEvent(eventId) {
    try {
      return await core.receive.deleteEvent(_db, _userId, _userId, eventId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getEvent(eventId) {
    const col = _db.collection(core.models.COLLECTIONS.ReceiveEvent);
    return col.findOne({ _id: eventId, ownerId: _userId });
  },
  /** 礼薄共计：{count, totalFen} */
  async getEventStats(eventId) {
    const recs = await core.receive.listRecords(_db, _userId, _userId, eventId);
    const totalFen = recs.reduce((s, r) => s + (r.amount || 0), 0);
    return { count: recs.length, totalFen };
  },

  // —— 收礼明细记录 ——
  async listRecords(eventId) {
    try {
      return await core.receive.listRecords(_db, _userId, _userId, eventId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async createRecord(eventId, { contactId, amountFen, type, remark, date }) {
    try {
      return await core.receive.createRecord(_db, _userId, _userId, eventId, {
        contactId, amount: amountFen, type, remark, date,
      });
    } catch (e) { throw new Error(friendly(e)); }
  },
  async updateRecord(recordId, patch) {
    try {
      return await core.receive.updateRecord(_db, _userId, _userId, recordId, patch);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async deleteRecord(recordId) {
    try {
      return await core.receive.deleteRecord(_db, _userId, _userId, recordId);
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getRecord(recordId) {
    const col = _db.collection(core.models.COLLECTIONS.ReceiveRecord);
    return col.findOne({ _id: recordId, ownerId: _userId });
  },

  // —— 往来 ——
  /**
   * 往来列表：每位亲友一行 {contactId, name, count, receiveFen, giftFen, diffFen}
   * @param {string} [ownerId] 缺省看自己账本；传他人 id 则为成员视角（只算授权部分）
   * @param {string|{start,end}} [range] 时间范围，缺省近一年
   */
  async getWanglaiList({ ownerId, range } = {}) {
    const oid = ownerId || _userId;
    const isMember = oid !== _userId;
    try {
      const contacts = await core.contacts.listContacts(_db, _userId, oid);
      const rows = [];
      let totalReceiveFen = 0, totalGiftFen = 0;
      for (const c of contacts) {
        const st = isMember
          ? await core.stats.memberStats(_db, _userId, oid, c._id, { range })
          : await core.stats.contactStats(_db, oid, c._id, { range });
        const count = st.receiveCount + st.giftCount;
        if (count === 0) continue;
        totalReceiveFen += st.receiveTotalFen;
        totalGiftFen += st.giftTotalFen;
        rows.push({
          contactId: c._id, name: c.name, remark: c.remark || '',
          count, receiveFen: st.receiveTotalFen, giftFen: st.giftTotalFen,
          diffFen: st.diffFen,
        });
      }
      // 按往来笔数倒序，笔数相同按姓名
      rows.sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
      return {
        rows, totalReceiveFen, totalGiftFen, diffFen: totalReceiveFen - totalGiftFen,
        isMember,
      };
    } catch (e) { throw new Error(friendly(e)); }
  },
  /** 往来页搜索：输入姓名出联系人（成员视角自动只搜可见的） */
  async searchWanglaiContacts({ ownerId, keyword } = {}) {
    const oid = ownerId || _userId;
    try {
      return await core.contacts.searchContacts(_db, _userId, oid, keyword || '');
    } catch (e) { throw new Error(friendly(e)); }
  },
  /**
   * 竖线树数据（成员视角自动过滤未授权记录）
   * @returns {items, receiveTotalFen, receiveCount, giftTotalFen, giftCount, diffFen, isMember}
   */
  async getTimeline({ contactId, ownerId, range } = {}) {
    const oid = ownerId || _userId;
    try {
      const tl = await core.stats.memberTimeline(_db, _userId, oid, contactId, { range });
      const c = await this.getContact(contactId, oid);
      return { ...tl, contactName: c ? c.name : '' };
    } catch (e) { throw new Error(friendly(e)); }
  },
  async getContact(contactId, ownerId) {
    const oid = ownerId || _userId;
    const col = _db.collection(core.models.COLLECTIONS.Contact);
    return col.findOne({ _id: contactId, ownerId: oid });
  },
  /**
   * 确认写入识别结果；逐条写，首条失败即停。
   * 成功返回 { written, total }；失败抛错（err.written/err.total 为已写入/总数），
   * 额度类错误消息为卖惨文案，直接展示。
   */
  async importWrite({ kind, eventId, items }) {
    const r = await core.importer.writeImport(_db, _userId, _userId, { kind, eventId, items });
    if (r.rawError) {
      const err = new Error(friendly(r.rawError));
      err.written = r.written;
      err.total = r.total;
      throw err;
    }
    return { written: r.written, total: r.total };
  },

  friendly,
};

module.exports = service;
