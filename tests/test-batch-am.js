/* AM批静态断言：会员功能名单接线点齐全（服务端三处 + 客户端三处 + 总闸） */
const assert = require('node:assert');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');

const features = rd('core/features.js');
assert.ok(features.includes('resolveMemberOnlyFeatures'), 'AM core/features 应有名单解析');
assert.ok(features.includes('isMemberOnlyFeature'), 'AM core/features 应有单项判定');
assert.ok(features.includes('memberOnly'), 'AM getFlags 应带出 memberOnly');

const imp = rd('core/import.js');
assert.ok(imp.includes("isMemberOnlyFeature(db, 'photoImport')"), 'AM 拍照导入会员关应查名单');
const share = rd('core/share.js');
assert.ok(share.includes("isMemberOnlyFeature(db, 'familyShareInvite')"), 'AM 家庭共享邀请会员关应查名单');

const route = rd('miniprogram/services/landscape-route.js');
assert.ok(route.includes('resolveLandscapeGate'), 'AM 横置路由应有两道闸判定');
const rotate = rd('miniprogram/pages/landscape/rotate/rotate.js');
const book = rd('miniprogram/pages/landscape/book-common.js');
assert.ok(rotate.includes('resolveLandscapeGate'), 'AM 请横屏页应走两道闸');
assert.ok(book.includes('resolveLandscapeGate'), 'AM 横置礼单本页应走两道闸');

const index = rd('miniprogram/pages/index/index.js');
assert.ok(index.includes("key = id === 'share' ? 'familyShareInvite' : 'photoImport'"), 'AM 首页入口会员提示应查名单');
const mine = rd('miniprogram/pages/mine/mine.js');
assert.ok(mine.includes("flags.memberOnly.includes('familyShareInvite')"), 'AM 我的页共享入口应查名单');
assert.ok(mine.includes("flags.landscape === false"), 'AM 我的页横置开关应先过总闸');

const ds = rd('miniprogram/services/data-service.js');
assert.ok(ds.includes('memberOnly'), 'AM data-service flags 应带名单');

const admin = rd('core/admin.js');
assert.ok(admin.includes('landscapeEnabled'), 'AM 后台应有横置总闸读写');

const cfg = rd('miniprogram/config/app-config.js');
assert.ok(/landscape:\s*true/.test(cfg), 'AM 静态配置横置总闸默认开');

console.log('✓ AM批·接线静态断言全过');
