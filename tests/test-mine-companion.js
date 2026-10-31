/** 我的页陪伴方块（2026-10-31 用户定）+ 头像/会员卡新色：
 * - 陪伴天数：注册当天算第 1 天，之后每天加 1；无/非法注册日返回 null
 * - 方块位置：会员卡片下、横置上面；淡粉 #FDE8E8 + 小书本图标 + “人情礼单簿已陪伴你 X 天”
 * - 头像栏：首页收礼左边 #FFE4B8 半透明淡黄，纯色不渐变
 * - 会员卡：首页送礼右边浓粉红 #F78C8F，纯色不渐变 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');
const { companionDays } = require('../core/users');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function at(y, m, d) { return new Date(y, m - 1, d, 12, 0, 0).getTime(); }

test('陪伴天数：注册当天算第 1 天，之后每天加 1', async () => {
  assert.eq(companionDays(at(2026, 10, 20), at(2026, 10, 20)), 1, '注册当天应为 1 天');
  assert.eq(companionDays(at(2026, 10, 20), at(2026, 10, 21)), 2, '次日应为 2 天');
  assert.eq(companionDays(at(2026, 10, 20), at(2026, 10, 31)), 12, '10 月 20 日到 10 月 31 日应为 12 天');
});

test('陪伴天数：无/非法注册日返回 null，不显示 0 天或乱数', async () => {
  assert.eq(companionDays(null, at(2026, 10, 31)), null, '无注册日应为 null');
  assert.eq(companionDays(0, at(2026, 10, 31)), null, '注册日 0 应为 null');
  assert.eq(companionDays('not-a-date', at(2026, 10, 31)), null, '非法注册日应为 null');
});

test('我的页陪伴方块：位置、淡粉底、小程序头像、文案与天数接线', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  const mineJs = read('miniprogram/pages/mine/mine.js');
  const memberIdx = wxml.indexOf('会员与积分');
  const companionIdx = wxml.indexOf('人情礼单簿已陪伴你');
  const landscapeIdx = wxml.indexOf('横置礼单本');
  assert(memberIdx >= 0 && companionIdx > memberIdx && landscapeIdx > companionIdx, '方块应在会员卡片下、横置上面');
  assert(wxml.includes('/images/logo.png'), '方块前应有小程序头像（logo.png，与陪伴文字同大 14px）');
  assert(wxml.includes('companionDays'), '方块应接 companionDays 天数');
  assert(wxss.includes('#FDE8E8'), '方块底色应为拍照导入淡粉 #FDE8E8');
  assert(mineJs.includes('getCompanionDays'), '我的页应从 data-service 取陪伴天数');
});

test('我的页头像栏与会员卡：新色纯色不渐变', async () => {
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  assert(wxss.includes('rgba(255, 228, 184, 0.6)'), '头像栏应为收礼左边 #FFE4B8 半透明淡黄');
  assert(wxss.includes('background: #F78C8F'), '会员卡应为送礼右边浓粉红 #F78C8F');
  assert(!wxss.includes('linear-gradient(135deg, #FFB84D'), '头像栏不应再有旧橙黄渐变');
  assert(!wxss.includes('linear-gradient(135deg, #F67070'), '会员卡不应再有旧红渐变');
});

/** 2026-10-31 陪伴兜底 + 行图标批（用户定）：
 * - getCompanionDays：优先 createdAt；无/非法时以注册赠送流水 createdAt 兜底；仍无回 null
 * - 陪伴方块样式：上下内边距 12px→8px、字号 16px→14px，天数加粗不动
 * - 7 行行首图标：PNG（不用 SVG，微信 image 对 SVG 支持不好，book.svg 真机上是空框），
 *   每行最左、文字右移、右边箭头/开关/计数不动；演示行不在内 */
const { getCompanionDays } = require('../core/users');
const { COLLECTIONS } = require('../core').models;

function fakeDb(uid, userDoc, ledgerDoc) {
  return {
    collection: (name) => ({
      findOne: async (q) => {
        if (name === COLLECTIONS.User) return q && q._id === uid ? userDoc : null;
        if (name === COLLECTIONS.PointsLedger) {
          return q && q.kind === 'register_grant' && q.refId === `register:${uid}` ? ledgerDoc : null;
        }
        return null;
      },
    }),
  };
}

test('陪伴兜底：优先 createdAt，无则注册赠送流水，仍无回 null', async () => {
  const now = at(2026, 10, 31);
  const db1 = fakeDb('u1', { _id: 'u1', createdAt: at(2026, 10, 20) }, { createdAt: at(2026, 10, 25) });
  assert.eq(await getCompanionDays(db1, 'u1', now), 12, '有 createdAt 时应优先它，不用流水日');
  const db2 = fakeDb('u1', { _id: 'u1', createdAt: null }, { createdAt: at(2026, 10, 20) });
  assert.eq(await getCompanionDays(db2, 'u1', now), 12, '无 createdAt 时应以注册赠送流水日兜底');
  const db3 = fakeDb('u1', { _id: 'u1', createdAt: 'not-a-date' }, null);
  assert.eq(await getCompanionDays(db3, 'u1', now), null, 'createdAt 非法且无流水时应回 null，不造假');
  const db4 = fakeDb('u1', null, null);
  assert.eq(await getCompanionDays(db4, 'u1', now), null, '用户与流水都无时应回 null');
  assert.eq(await getCompanionDays(fakeDb('u1', null, null), '', now), null, '无用户时应回 null');
});

test('陪伴方块样式：上下 4px、字号 18px，陪伴图标改 PNG（SVG 真机空框）', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml');
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  // 2026-11-01 用户改定：陪伴字 16→18、图标 32px 约卡高八成（卡上下内边距收至 4px），
  // 取代旧 8px／16px 口径；左右 16px、天数加粗、居中不动。
  assert(wxss.includes('padding: 4px 16px'), '陪伴方块上下内边距应为 4px（左右 16px 不动，图标约占卡高八成）');
  assert(wxss.includes('.companion-text { font-size: 18px'), '陪伴文字应为 18px');
  assert(wxss.includes('.companion-days { font-weight: 600'), '天数加粗不动');
  // 2026-10-31 用户定：陪伴文本上下左右居中（图标＋文字整组居中，不靠左）
  assert(wxss.includes('justify-content: center'), '陪伴方块应水平居中');
  assert(wxss.includes('align-items: center'), '陪伴方块应垂直居中');
  assert(/\.companion-card \{[^}]*text-align: center/.test(wxss), '陪伴方块文字应居中');
  assert(wxml.includes('/images/logo.png'), '陪伴图标应为小程序头像 logo.png，不再用小书本图标');
  assert(!wxml.includes('/images/icons/book.svg'), '我的页不应再引用 book.svg');
});

test('我的页 7 行行首图标：PNG、最左、右边不动，演示行不在内', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const rows = [
    ['mine-landscape.png', '横置礼单本'], ['mine-invite.png', '邀请分享'],
    ['mine-notify.png', '通知'], ['mine-feedback.png', '意见反馈'],
    ['mine-faq.png', '常见问题'], ['mine-about.png', '关于我们'],
    ['mine-contact.png', '联系客服'],
  ];
  for (const [png, label] of rows) {
    const iconIdx = wxml.indexOf(png);
    const labelIdx = wxml.indexOf(label);
    assert(iconIdx >= 0 && labelIdx > iconIdx, `${label} 行最左应有 ${png}`);
    const pngPath = path.join(ROOT, 'miniprogram/images/icons', png);
    const buf = fs.readFileSync(pngPath);
    assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, `${png} 应为真 PNG 字节，不是 SVG 文本`);
  }
  assert.eq((wxml.match(/class="row-icon"/g) || []).length, 7, '行图标应恰好 7 个，演示行不在内');
  // 2026-10-31 用户定：联系客服图标由信封改耳机（mine-contact.svg 应为头梁＋两耳罩）
  const contactSvg = read('miniprogram/images/icons/mine-contact.svg');
  assert(contactSvg.includes('a16 16'), '联系客服图标应为耳机头梁弧线');
  assert(contactSvg.includes('y="31"'), '联系客服图标应有两耳罩');
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  assert(wxss.includes('.row-icon { width: 20px; height: 20px; flex: none; margin-right: 8px; }'), '行图标应为 20px、与文字留 8px');
  const ds = read('miniprogram/services/data-service.js');
  assert(ds.includes('register_grant'), '客户端兜底应查注册赠送流水');
  const remote = read('miniprogram/services/remote-core.js');
  assert(remote.includes('getCompanionDays'), '云函数远程清单应登记 getCompanionDays');
});

/** 2026-10-31 用户批准的格式兼容改法 + 无注册日文案纠正：
 * - companionDays 认数字、数字文字、Date 对象、ISO 日期文字、日期文字；
 *   账号查询服务端 new Date 能显示的日期，小程序这边也不能因格式算成空
 * - 无注册日（null）时方块显示“人情礼单簿每天陪伴你”，有天数时仍是
 *   “人情礼单簿已陪伴你 X 天”，不编天数 */
test('陪伴天数：日期文字格式也认，非法仍回 null', async () => {
  const now = at(2026, 10, 31);
  assert.eq(companionDays('2026-10-20', now), 12, '日期文字 2026-10-20 到 10 月 31 日应为 12 天');
  assert.eq(companionDays(new Date(2026, 9, 20, 12, 0, 0).toISOString(), now), 12, 'ISO 日期文字应为 12 天');
  assert.eq(companionDays(new Date(2026, 9, 20, 12, 0, 0), now), 12, 'Date 对象应为 12 天');
  assert.eq(companionDays(String(at(2026, 10, 20)), now), 12, '数字文字应为 12 天');
  assert.eq(companionDays({ $date: '2026-10-20T04:00:00.000Z' }, now), 12, '$date 包裹的日期文字应为 12 天');
  assert.eq(companionDays('', now), null, '空文字应为 null');
  assert.eq(companionDays('2026-13-40', now), null, '不存在的日期文字应为 null');
});

test('无注册日时陪伴方块显示“人情礼单簿每天陪伴你”', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  assert(wxml.includes('人情礼单簿每天陪伴你'), '无注册日时方块应显示每天陪伴你');
  assert(wxml.includes('wx:else'), '无注册日分支应用 wx:else，与有天数分支区分');
  assert(wxml.includes('wx:if="{{companionDays}}">人情礼单簿已陪伴你'), '有天数时仍应显示已陪伴你 X 天');
});

/** 2026-10-31 真机教训＋用户定头像（陪伴根因）：云模式 remote-core users
 * 清单漏了本地纯函数 companionDays，data-service 在云模式下直接调它即
 * 报错、被我的页静默吞掉，方块永显“每天陪伴你”，而本地测试因本地 core
 * 有此函数全过、掩盖了漏登记。本测试直接建 remote-core 实例断言：
 * users.companionDays 必须是本地函数、2026-10-23 到 10 月 31 日算出 9 天；
 * 陪伴图标改为小程序头像 logo.png、尺寸与陪伴文字同大 14px。 */
test('云模式 remote-core：users.companionDays 必须本地登记、算出 9 天', async () => {
  const { createRemoteCore } = require('../miniprogram/services/remote-core');
  const remote = createRemoteCore();
  assert.eq(typeof remote.users.companionDays, 'function', '云模式 remote-core users.companionDays 应为本地函数，漏登记时本测试失败');
  assert.eq(remote.users.companionDays(at(2026, 10, 23), at(2026, 10, 31)), 9, '云模式下 2026-10-23 到 10 月 31 日应为 9 天');
});

test('陪伴图标：小程序头像 logo.png、32px 明显大于文字 18px', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml');
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  assert(wxml.includes('/images/logo.png'), '陪伴图标应为小程序头像 logo.png');
  assert(!wxml.includes('/images/icons/mine-companion.png'), '陪伴图标不应再用小书本图标');
  assert(wxss.includes('.companion-icon { width: 32px; height: 32px;'), '陪伴头像应为 32px，明显大于陪伴文字 18px（2026-11-01 改定，取代旧 17px／16px）');
});
