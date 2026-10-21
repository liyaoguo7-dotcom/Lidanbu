/**
 * 横置入口路由测试（收尾接线）
 * 覆盖：开关关→竖置；开关开+会员→横置；开关开+非会员→竖置（双保险）；
 * storage 读写往返（假 storage）；「返回竖屏」写回关闭后不再自动进横置。
 */
const { test, assert } = require('./fw');
const LR = require('../miniprogram/services/landscape-route.js');

function memStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : ''), set: (k, v) => m.set(k, v), _map: m };
}

test('横置路由-开关关：会员也走竖置（与接线前行为一致）', () => {
  assert.eq(LR.resolveBookRoute({ landscapeOn: false, membership: { state: 'member' } }), 'portrait', '关+member');
  assert.eq(LR.resolveBookRoute({ landscapeOn: false, membership: { state: 'grace' } }), 'portrait', '关+grace');
  assert.eq(LR.resolveBookRoute({ landscapeOn: false, membership: null }), 'portrait', '关+无会员信息');
  assert.eq(LR.resolveBookRoute({}), 'portrait', '无入参默认竖置');
  assert.eq(LR.resolveBookRoute(), 'portrait', '不传参默认竖置');
});

test('横置路由-开关开+会员：走横置（member 与 grace 均可）', () => {
  assert.eq(LR.resolveBookRoute({ landscapeOn: true, membership: { state: 'member' } }), 'landscape', '开+member');
  assert.eq(LR.resolveBookRoute({ landscapeOn: true, membership: { state: 'grace' } }), 'landscape', '开+grace（缓冲期只读但可看）');
  assert.eq(LR.resolveBookRoute({ landscapeOn: true, membership: true }), 'landscape', '开+布尔会员');
});

test('横置路由-开关开+非会员：走竖置（双保险，不靠页内门禁兜底）', () => {
  assert.eq(LR.resolveBookRoute({ landscapeOn: true, membership: { state: 'free' } }), 'portrait', '开+free');
  assert.eq(LR.resolveBookRoute({ landscapeOn: true, membership: { state: 'expired' } }), 'portrait', '开+expired');
  assert.eq(LR.resolveBookRoute({ landscapeOn: true, membership: null }), 'portrait', '开+会员信息缺失');
  assert.eq(LR.resolveBookRoute({ landscapeOn: true }), 'portrait', '开+未传会员信息');
});

test('横置路由-storage往返：空默认关，写入开读回开，写入关读回关', () => {
  const st = memStorage();
  assert.eq(LR.STORAGE_KEY, 'landscapeModeOn', 'storage key 与需求一致');
  assert.eq(LR.readLandscapeOn(st), false, '空 storage 默认关');
  LR.writeLandscapeOn(true, st);
  assert.eq(st._map.get('landscapeModeOn'), true, '写入的是布尔 true');
  assert.eq(LR.readLandscapeOn(st), true, '读回开');
  LR.writeLandscapeOn(false, st);
  assert.eq(LR.readLandscapeOn(st), false, '写入关后读回关');
});

test('横置路由-storage兼容：历史字符串值 1/true 也算开，其余算关', () => {
  const st = memStorage();
  st.set('landscapeModeOn', '1');
  assert.eq(LR.readLandscapeOn(st), true, "'1' 算开");
  st.set('landscapeModeOn', 'true');
  assert.eq(LR.readLandscapeOn(st), true, "'true' 算开");
  st.set('landscapeModeOn', '0');
  assert.eq(LR.readLandscapeOn(st), false, "'0' 算关");
  st.set('landscapeModeOn', '');
  assert.eq(LR.readLandscapeOn(st), false, '空串算关');
});

test('横置路由-返回竖屏：写回关闭后 resolve 变竖置（不会被开关再次自动带回）', () => {
  const st = memStorage();
  LR.writeLandscapeOn(true, st);
  const before = LR.resolveBookRoute({ landscapeOn: LR.readLandscapeOn(st), membership: { state: 'member' } });
  assert.eq(before, 'landscape', '开着时进横置');
  // 模拟横置页 goPortrait 的写回动作
  LR.writeLandscapeOn(false, st);
  const after = LR.resolveBookRoute({ landscapeOn: LR.readLandscapeOn(st), membership: { state: 'member' } });
  assert.eq(after, 'portrait', '写回关闭后回竖置');
});
