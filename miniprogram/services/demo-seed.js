/**
 * 礼单簿 · 本地演示数据（阶段2 演示包）
 *
 * 只在本地演示模式（AppConfig.demo.localMode=true）下由 data-service 调用，
 * 给演示用户种一套完整假数据，让每个页面打开都有内容看：
 * 亲友 12 位、收礼礼薄 3 个、收礼记录 21 条、送礼记录 8 条。
 * 所有种下的数据都带 seed:true 标记（联系人尤其重要：邀请奖励的
 * "新用户"判定要能把演示种子排除在外，判定口径在 core/invite-reward）。
 *
 * 金额一律整档（500/1000/2000/3000/4000/10000 元，存分），名单与金额
 * 与横置礼单本定版示例口径一致；日期相对今天往前分布在近一年内，
 * 保证往来页（默认近一年）随时打开都有数据。
 *
 * 本模块不依赖 wx：db 与 core 由调用方注入，可在 Node 里用 MemoryDB 测试。
 */

const DAY = 86400e3;

/** 往前推 days 天的日期字符串 YYYY-MM-DD（记录的 date 字段用） */
function dateDaysAgo(days, now = Date.now()) {
  const d = new Date(now - days * DAY);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------- 演示会员状态切换 ---------------- */

/**
 * 演示切换的三种会员状态 → 写入用户文档的 membership 值。
 * 只写 membership 这一个字段，状态与额度一律走 core/quota 的
 * getMembershipState / getEffectiveQuota 现行计算，不另起假逻辑：
 * - free：免费用户
 * - member：会员（到期日在一年后）
 * - grace：会员已到期（缓冲期）——到期日在 5 天前，落在 30 天缓冲期内
 */
function membershipForMode(mode, now = Date.now()) {
  if (mode === 'member') return { status: 'member', expireAt: now + 365 * DAY, graceUntil: null };
  if (mode === 'grace') return { status: 'member', expireAt: now - 5 * DAY, graceUntil: null };
  return { status: 'free', expireAt: null, graceUntil: null };
}

/** 应用演示会员状态切换，返回切换后经现行计算得到的状态 free|member|grace|expired */
async function applyDemoMembership(db, core, userId, mode) {
  const C = core.models.COLLECTIONS;
  await db.collection(C.User).update({ _id: userId }, { membership: membershipForMode(mode) });
  const user = await db.collection(C.User).findOne({ _id: userId });
  return core.quota.getMembershipState(user);
}

/* ---------------- 演示数据集 ---------------- */

/** 亲友名单（与横置定版示例一致，含 4 字名欧阳修远与复姓欧阳） */
const DEMO_CONTACTS = [
  { name: '张三', remark: '同学' },
  { name: '李四', remark: '邻居' },
  { name: '王五', remark: '表哥' },
  { name: '赵六', remark: '叔叔' },
  { name: '刘七', remark: '同事' },
  { name: '陈八', remark: '朋友' },
  { name: '孙九', remark: '邻居' },
  { name: '周十', remark: '同学' },
  { name: '吴小明', remark: '晚辈' },
  { name: '郑文杰', remark: '同事' },
  { name: '欧阳修远', remark: '朋友' },
  { name: '欧阳', remark: '朋友' },
];

/** 整档金额（元）：演示只用这六档 */
const YUAN = { y500: 50000, y1000: 100000, y2000: 200000, y3000: 300000, y4000: 400000, y10000: 1000000 };

/**
 * 礼薄定义：records 为 [亲友名, 金额(分), 收礼类型]，日期同礼薄日期。
 * 张三的婚礼 12 条与横置定版图逐列一致；王老太爷丧礼（白事）4 条同定版图。
 */
const DEMO_EVENTS = [
  {
    name: '张三的婚礼', tagId: 'jiehun', daysAgo: 2,
    records: [
      ['张三', YUAN.y1000, '现金'], ['李四', YUAN.y500, '红包'], ['王五', YUAN.y500, '微信'],
      ['赵六', YUAN.y2000, '现金'], ['刘七', YUAN.y1000, '转账'], ['陈八', YUAN.y3000, '现金'],
      ['孙九', YUAN.y1000, '红包'], ['周十', YUAN.y10000, '现金'], ['吴小明', YUAN.y500, '微信'],
      ['郑文杰', YUAN.y4000, '转账'], ['欧阳修远', YUAN.y1000, '现金'], ['欧阳', YUAN.y2000, '红包'],
    ],
  },
  {
    name: '赵六的乔迁宴', tagId: 'qiaoqian', daysAgo: 150,
    records: [
      ['张三', YUAN.y1000, '现金'], ['李四', YUAN.y500, '红包'], ['王五', YUAN.y1000, '微信'],
      ['陈八', YUAN.y2000, '现金'], ['孙九', YUAN.y500, '红包'],
    ],
  },
  {
    name: '王老太爷丧礼', tagId: 'baishi', daysAgo: 60,
    records: [
      ['张三', YUAN.y1000, '现金'], ['李四', YUAN.y500, '红包'],
      ['王五', YUAN.y500, '现金'], ['赵六', YUAN.y2000, '现金'],
    ],
  },
];

/** 送礼定义：[亲友名, 标签, 金额(分), 几天前]；王五一条是白事奠仪 */
const DEMO_GIFTS = [
  ['张三', 'jiehun', YUAN.y1000, 20],
  ['李四', 'shengri', YUAN.y500, 90],
  ['王五', 'baishi', YUAN.y500, 45],
  ['赵六', 'qiaoqian', YUAN.y2000, 150],
  ['刘七', 'tanwang', YUAN.y1000, 200],
  ['陈八', 'shengzi', YUAN.y3000, 260],
  ['孙九', 'yasui', YUAN.y1000, 300],
  ['周十', 'dashou', YUAN.y10000, 330],
];

/**
 * 种下整套演示数据（经 core 正规创建路径，额度/审计都按真实规则走），
 * 每条种完打 seed:true 标记。用户已有种子标记数据时跳过整套（防重复种）。
 * @returns {{skipped:boolean, contacts:number, events:number, records:number, gifts:number}}
 */
async function seedDemoData(db, core, userId, now = Date.now()) {
  const C = core.models.COLLECTIONS;
  const already = await db.collection(C.Contact).count({ ownerId: userId, seed: true });
  if (already > 0) return { skipped: true, contacts: 0, events: 0, records: 0, gifts: 0 };

  const mark = (colName) => async (id) => {
    await db.collection(colName).update({ _id: id }, { seed: true });
  };

  // 亲友
  const contactIdByName = {};
  for (const c of DEMO_CONTACTS) {
    const { _id } = await core.contacts.createContact(db, userId, userId, c);
    await mark(C.Contact)(_id);
    contactIdByName[c.name] = _id;
  }

  // 礼薄 + 收礼记录
  let eventCount = 0;
  let recordCount = 0;
  for (const ev of DEMO_EVENTS) {
    const date = dateDaysAgo(ev.daysAgo, now);
    const { _id: eventId } = await core.receive.createEvent(db, userId, userId, {
      name: ev.name, tagId: ev.tagId, date,
    });
    await mark(C.ReceiveEvent)(eventId);
    eventCount++;
    for (const [contactName, amount, type] of ev.records) {
      const { _id } = await core.receive.createRecord(db, userId, userId, eventId, {
        contactId: contactIdByName[contactName], amount, type, date,
      });
      await mark(C.ReceiveRecord)(_id);
      recordCount++;
    }
  }

  // 送礼记录
  let giftCount = 0;
  for (const [contactName, tagId, amount, daysAgo] of DEMO_GIFTS) {
    const { _id } = await core.gifts.createGift(db, userId, userId, {
      contactId: contactIdByName[contactName], tagId, amount, date: dateDaysAgo(daysAgo, now),
    });
    await mark(C.GiftRecord)(_id);
    giftCount++;
  }

  return { skipped: false, contacts: DEMO_CONTACTS.length, events: eventCount, records: recordCount, gifts: giftCount };
}

module.exports = {
  dateDaysAgo,
  membershipForMode,
  applyDemoMembership,
  seedDemoData,
  DEMO_CONTACTS,
  DEMO_EVENTS,
  DEMO_GIFTS,
};
