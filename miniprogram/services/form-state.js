/**
 * 礼单簿 · 表单状态保持（阶段2 2A）
 *
 * 场景：添加送礼记录页跳转"选择亲友"（或新增亲友）再返回时，
 * 已填的标签/日期/金额/备注不能丢。
 *
 * 纯函数 + 可注入的存储，Node 可测，小程序里用 wx 存储。
 */

function saveForm(storage, key, form) {
  const snapshot = {
    tagId: form.tagId || '',
    date: form.date || '',
    contactId: form.contactId || '',
    contactName: form.contactName || '',
    amount: form.amount || '',
    remark: form.remark || '',
    savedAt: Date.now(),
  };
  storage.set(key, JSON.stringify(snapshot));
  return snapshot;
}

function restoreForm(storage, key) {
  const raw = storage.get(key);
  if (!raw) return null;
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!s || typeof s !== 'object') return null;
    return {
      tagId: s.tagId || '',
      date: s.date || '',
      contactId: s.contactId || '',
      contactName: s.contactName || '',
      amount: s.amount || '',
      remark: s.remark || '',
    };
  } catch (e) {
    return null;
  }
}

function clearForm(storage, key) {
  storage.remove(key);
}

function wxStorage() {
  return {
    get(k) { try { return wx.getStorageSync(k); } catch (e) { return undefined; } },
    set(k, v) { try { wx.setStorageSync(k, v); } catch (e) { /* ignore */ } },
    remove(k) { try { wx.removeStorageSync(k); } catch (e) { /* ignore */ } },
  };
}

const GIFT_ADD_KEY = 'lidanbu_form_gift_add';
const PICK_KEY = 'lidanbu_pending_pick';

/** 选择亲友页回传：暂存待领取的选项 */
function savePick(storage, pick) {
  storage.set(PICK_KEY, JSON.stringify(pick || null));
}

/** 表单页 onShow 调用：有待领取选项则返回并清空 */
function takePick(storage) {
  const raw = storage.get(PICK_KEY);
  if (!raw) return null;
  clearForm(storage, PICK_KEY);
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (p && p.contactId) return p;
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { saveForm, restoreForm, clearForm, wxStorage, GIFT_ADD_KEY, savePick, takePick };
