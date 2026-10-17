/** 表单状态保持测试：跳转选择亲友再返回，已填内容不丢 */
const { saveForm, restoreForm, clearForm, GIFT_ADD_KEY } = require('../miniprogram/services/form-state');
const { test, assert } = require('./fw');

function memStorage() {
  const m = new Map();
  return {
    get(k) { return m.has(k) ? m.get(k) : undefined; },
    set(k, v) { m.set(k, v); },
    remove(k) { m.delete(k); },
  };
}

test('表单：保存后恢复，已填的标签/日期/金额/备注都在', () => {
  const st = memStorage();
  saveForm(st, GIFT_ADD_KEY, {
    tagId: 'shengri', date: '2026-10-18', contactId: '', contactName: '',
    amount: '1000', remark: '生日快乐',
  });
  const r = restoreForm(st, GIFT_ADD_KEY);
  assert.eq(r.tagId, 'shengri', '标签保留');
  assert.eq(r.date, '2026-10-18', '日期保留');
  assert.eq(r.amount, '1000', '金额保留');
  assert.eq(r.remark, '生日快乐', '备注保留');
});

test('表单：选完亲友回来，只补姓名不丢其他', () => {
  const st = memStorage();
  saveForm(st, GIFT_ADD_KEY, { tagId: 'jiehun', date: '2026-10-18', amount: '2000', remark: '' });
  // 模拟从选择亲友页返回，带回 contactId/contactName
  const cur = restoreForm(st, GIFT_ADD_KEY);
  cur.contactId = 'c_1'; cur.contactName = '张三';
  saveForm(st, GIFT_ADD_KEY, cur);
  const r = restoreForm(st, GIFT_ADD_KEY);
  assert.eq(r.contactName, '张三', '姓名补上');
  assert.eq(r.amount, '2000', '金额还在');
  assert.eq(r.tagId, 'jiehun', '标签还在');
});

test('表单：提交成功后清空；损坏数据返回 null 不崩', () => {
  const st = memStorage();
  saveForm(st, GIFT_ADD_KEY, { amount: '5' });
  clearForm(st, GIFT_ADD_KEY);
  assert(restoreForm(st, GIFT_ADD_KEY) === null, '清空后为 null');
  st.set(GIFT_ADD_KEY, '{broken');
  assert(restoreForm(st, GIFT_ADD_KEY) === null, '损坏数据返回 null');
});
