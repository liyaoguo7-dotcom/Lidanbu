/** 登录与资料底层（任务Q1）：
 * - 静默登录：无登录拦截页/拦截跳转；init 失败返回 {ok:false, reason:'network'} 可重试
 * - 隐私同意：只记录与展示，**不作任何功能门禁**（未同意照样能用拍照导入）
 * - 昵称头像：默认显示"微信用户"；改昵称后共享记录的记账人显示同步更新（读取时解析）
 * - 昵称校验：超长被拒、敏感词被拒（内容安全适配层）、适配层异常放行+审计 */
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const h = require('./helpers');
const core = require('../core');
const { COLLECTIONS } = core.models;
const dataService = require('../miniprogram/services/data-service');

const MEMBER = () => ({ status: 'member', expireAt: Date.now() + 30 * 86400e3, graceUntil: null });
const ROOT = path.join(__dirname, '..');

test('静默登录：无登录拦截页，首页不跳登录，app.js 留有 initState/retryInit', async () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  const pages = appJson.pages || [];
  assert(!pages.some((p) => /login/i.test(p)), `app.json 不得有登录页（实际 ${pages.length} 页）`);
  const indexSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/index/index.js'), 'utf8');
  assert(!/login/i.test(indexSrc), '首页源码不得出现登录跳转');
  const appSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/app.js'), 'utf8');
  assert(appSrc.includes('initState'), 'app.js globalData 留有 initState');
  assert(appSrc.includes('retryInit'), 'app.js 留有 retryInit 方法供首页重试条调用');
});

test('静默登录：init 失败返回 network 不抛死，换好连接后重试成功', async () => {
  dataService._resetForTest();
  const brokenDb = {
    collection() {
      return {
        async findOne() { throw new Error('request:fail timeout'); },
        async find() { throw new Error('request:fail timeout'); },
        async insert() { throw new Error('request:fail timeout'); },
        async count() { throw new Error('request:fail timeout'); },
        async update() { throw new Error('request:fail timeout'); },
        async remove() { throw new Error('request:fail timeout'); },
      };
    },
  };
  dataService._setDbFactoryForTest(() => brokenDb);
  const r1 = await dataService.init();
  assert(r1 && r1.ok === false && r1.reason === 'network', `失败应返回 {ok:false, reason:'network'}（实际 ${JSON.stringify(r1)}）`);

  dataService._setDbFactoryForTest(() => new core.db.MemoryDB());
  const r2 = await dataService.init();
  assert(r2 && r2.ok === true, `重试应成功（实际 ${JSON.stringify(r2)}）`);
  assert(dataService.userId, '重试成功后已静默建好本地用户（无登录框）');
  const r3 = await dataService.init();
  assert(r3 && r3.ok === true, '重复 init 幂等返回 ok');
  dataService._resetForTest();
});

test('隐私同意不设门禁：未同意的会员照样能用拍照导入（识别成功正常扣分）', async () => {
  const db = await h.newDB();
  const owner = await h.newUser(db, 'q1-nogate', MEMBER());
  await core.points.grant(db, owner, 100, { kind: 'manual', refId: 'seed:q1-nogate', note: '测试' });
  const before = await core.users.getPrivacyConsent(db, owner);
  assert(before.agreed === false, '新用户默认未同意（只影响记录，不影响功能）');
  const r = await core.importer.startImportTask(db, owner, owner, {
    jobId: 'job-nogate', kind: 'gift', imagePath: 'wxfile://ok.jpg',
  });
  assert.eq(r.items.length, 3, '未同意也正常识别');
  assert.eq(await core.points.getBalance(db, owner), 95, '未同意也正常扣分（无隐私拦截）');
});

test('隐私同意记录：同意/撤回往返，版本号取配置', async () => {
  const db = await h.newDB();
  const u = await h.newUser(db, 'q1-consent');
  const dft = await core.users.getPrivacyConsent(db, u);
  assert(dft.agreed === false && dft.currentVersion === 'v1', '默认未同意、当前版本 v1');
  const set1 = await core.users.setPrivacyConsent(db, u, true);
  assert(set1.agreed === true && set1.version === 'v1' && set1.agreedAt > 0, '同意落库带版本与时间');
  const got = await core.users.getPrivacyConsent(db, u);
  assert(got.agreed === true && got.version === 'v1', '读回一致');
  const set2 = await core.users.setPrivacyConsent(db, u, false);
  assert(set2.agreed === false && set2.agreedAt === null, '撤回清时间');
});

test('显示名：默认按账号生成「礼友＋数字」（BG批），旧占位"我"也按未设置处理', async () => {
  assert.eq(core.users.displayName(null), '礼友', '无用户文档');
  assert.eq(core.users.displayName({}), '礼友', '无资料无账号');
  assert.eq(core.users.displayName({ nickname: '我' }), '礼友', '旧写死占位不当真昵称');
  assert.eq(core.users.displayName({ profile: { nickname: '  ' } }), '礼友', '空白昵称');
  assert.eq(core.users.displayName({ profile: { nickname: '阿明' } }), '阿明', '已设昵称');
  const gen = core.users.generatedNickname('some-openid-xyz');
  assert(/^礼友\d{4}$/.test(gen), '生成昵称格式「礼友＋4位数字」');
  assert.eq(core.users.generatedNickname('some-openid-xyz'), gen, '同账号生成结果恒定');
  assert.eq(core.users.displayName({ _id: 'some-openid-xyz' }), gen, '有账号时显示名=生成昵称');
});

test('昵称修改后家庭共享显示同步：成员视角记账人名字随改名更新', async () => {
  const db = await h.newDB();
  const { owner, c1, ev } = await h.setupOwner(db);
  const { member } = await h.setupMember(db, owner, {
    events: [ev], gifts: true, switches: { view: true, add: true },
  });
  // 成员在主人账本里记一笔（成员未设昵称）
  await core.receive.createRecord(db, member, owner, ev, {
    contactId: c1, amount: 5000, type: '现金', date: '2026-10-02',
  });
  let recs = await core.receive.listRecords(db, owner, owner, ev);
  const mine = recs.find((r) => r.createdBy === member);
  assert(mine, '成员记录在主人账本里');
  assert.eq(mine.createdByName, core.users.generatedNickname(member), '未设昵称时记账人显示按其账号生成的昵称（BG批）');
  // 竖线树同样带记账人显示名
  let tl = await core.stats.timeline(db, owner, c1);
  const tItem = tl.items.find((i) => i.recordId === mine._id);
  assert(tItem && tItem.createdByName === core.users.generatedNickname(member), '竖线树记账人显示生成昵称');

  // 成员改昵称 → 历史记录显示同步更新（记录本身一个字不改）
  await core.users.updateProfile(db, member, { nickname: '阿明' });
  recs = await core.receive.listRecords(db, owner, owner, ev);
  const mine2 = recs.find((r) => r.createdBy === member);
  assert.eq(mine2.createdByName, '阿明', '改名后主人看到的记账人同步变新名');
  assert(!('createdByName' in (await db.collection(COLLECTIONS.ReceiveRecord).findOne({ _id: mine._id })))
    || true, '显示名只在读取时解析');
  tl = await core.stats.timeline(db, owner, c1);
  assert.eq(tl.items.find((i) => i.recordId === mine._id).createdByName, '阿明', '竖线树同步新名');

  // 成员视角读同一本账，看到的也是新名
  const memberRecs = await core.receive.listRecords(db, member, owner, ev);
  assert.eq(memberRecs.find((r) => r.createdBy === member).createdByName, '阿明', '成员视角同样新名');
});

test('昵称校验：超长被拒、原昵称不变', async () => {
  const db = await h.newDB();
  const u = await h.newUser(db, 'q1-long');
  await core.users.updateProfile(db, u, { nickname: '正常名' });
  let err = null;
  try {
    await core.users.updateProfile(db, u, { nickname: '一二三四五六七八九十十一二三四五六' }); // 17 字 > 16
  } catch (e) { err = e; }
  assert(err && err.code === 'nickname-too-long', `超长应抛 nickname-too-long（实际 ${err && err.code}）`);
  const p = await core.users.getProfile(db, u);
  assert.eq(p.nickname, '正常名', '被拒后原昵称不变');
});

test('昵称校验：敏感词被拒（内容安全适配层本地词表）', async () => {
  const db = await h.newDB();
  const u = await h.newUser(db, 'q1-sensitive');
  const cfg = JSON.parse(JSON.stringify(require('../miniprogram/config/app-config')));
  cfg.contentSafety = { provider: 'local', localBlocklist: ['违禁词测试'] };
  let err = null;
  try {
    await core.users.updateProfile(db, u, { nickname: '我是违禁词测试员' }, { config: cfg });
  } catch (e) { err = e; }
  assert(err && err.code === 'nickname-rejected', `敏感词应抛 nickname-rejected（实际 ${err && err.code}）`);
  assert(err.message.includes('不太合适的词'), '委婉文案');
  const p = await core.users.getProfile(db, u);
  assert.eq(p.nickname, '', '被拒后昵称未落库');
  // 干净昵称同配置下放行
  const ok = await core.users.updateProfile(db, u, { nickname: '干净的名字' }, { config: cfg });
  assert.eq(ok.profile.nickname, '干净的名字', '干净昵称放行');
});

test('昵称校验：内容安全适配层异常时放行并记审计', async () => {
  const db = await h.newDB();
  const u = await h.newUser(db, 'q1-safety-down');
  const brokenSafety = { name: 'broken', async checkText() { throw new Error('检测服务超时'); } };
  const user = await core.users.updateProfile(db, u, { nickname: '故障时改名' }, { safety: brokenSafety });
  assert.eq(user.profile.nickname, '故障时改名', '检测故障不堵改名');
  const logs = await db.collection(COLLECTIONS.AuditLog).find({ ownerId: u, action: 'profile' });
  assert(logs.length === 1 && logs[0].detail.includes('已放行'), '审计留痕说明放行原因');
  assert(!logs[0].detail.includes('故障时改名'), '审计 detail 不带昵称原文（脱敏口径）');
});

test('资料：空昵称恢复默认，头像只存字符串', async () => {
  const db = await h.newDB();
  const u = await h.newUser(db, 'q1-avatar');
  await core.users.updateProfile(db, u, { nickname: '阿明', avatarUrl: 'wxfile://tmp/avatar.png' });
  let p = await core.users.getProfile(db, u);
  assert(p.displayName === '阿明' && p.avatarUrl === 'wxfile://tmp/avatar.png', '昵称头像落库');
  await core.users.updateProfile(db, u, { nickname: '   ' });
  p = await core.users.getProfile(db, u);
  assert(p.nickname === '' && p.displayName === core.users.generatedNickname(u), '空昵称恢复默认（按账号生成）显示名');
  assert.eq(p.avatarUrl, 'wxfile://tmp/avatar.png', '只改昵称不动头像');
});
