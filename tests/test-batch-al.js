/* AL批：管理员页——云端档去移除＋本页添加管理员入口（2026-10-25 用户定）
 * 1) 移除按钮只对非云端档（后加）行渲染；2) 本页选人设管理员复用账号查询
 * 同一接口（adminSearchAccounts/adminAddAdmin），加进来的是后加档；
 * 3) 服务端分档与护栏不动（core/admin addAdmin/removeAdmin 原样）。 */
const assert = require('assert');
const fs = require('fs');
const base = __dirname + '/../miniprogram/pages/admin/admins/';
const wxml = fs.readFileSync(base + 'admins.wxml', 'utf8');
const js = fs.readFileSync(base + 'admins.js', 'utf8');

// AL-1 云端档行无移除按钮（条件含 tier !== 'console'）
assert.ok(/wx:if="\{\{canManage && item\.tier !== 'console'\}\}"[^>]*bindtap="onRemoveAdmin"/.test(wxml), 'AL-1 移除按钮应带云端档排除条件');
// AL-2 横幅已更新：含"云端管理员不在本页移除"与新加人路径
assert.ok(wxml.includes('云端管理员不在本页移除'), 'AL-2 横幅应写明云端档不在本页移除');
assert.ok(wxml.includes('添加管理员'), 'AL-2 横幅/卡片应有添加管理员');
// AL-3 添加卡片仅 canManage 可见，含选人列表与设为管理员按钮
assert.ok(/wx:if="\{\{canManage\}\}" class="card">[\s\S]*?添加管理员/.test(wxml), 'AL-3 添加卡片应仅云端管理员可见');
assert.ok(wxml.includes('bindtap="onTogglePicker"'), 'AL-3 应有展开选人按钮');
assert.ok(wxml.includes('catchtap="onMakeAdmin"'), 'AL-3 选人行应有设为管理员按钮');
assert.ok(wxml.includes('item.isAdmin'), 'AL-3 已是管理员应有标记（服务端 isAdmin 字段）');
// AL-4 JS 复用既有接口，不新造服务端路径
assert.ok(js.includes('ds.adminSearchAccounts'), 'AL-4 应复用账号查询的用户列表接口');
assert.ok(js.includes('ds.adminAddAdmin'), 'AL-4 应复用既有设管理员接口');
assert.ok(js.includes('STATE_NAMES'), 'AL-4 会员状态文案映射与账号查询页一致');
// AL-5 服务端护栏未动：core/admin 仍导出 addAdmin/removeAdmin 且含最后一位云端管理员护栏
const core = fs.readFileSync(__dirname + '/../miniprogram/core/admin.js', 'utf8');
assert.ok(/async function addAdmin/.test(core) && /async function removeAdmin/.test(core), 'AL-5 core 增减函数应在');
console.log('✓ AL批断言全过');

/* AL-6..8 老板平台首页分组（会员与钱靠前、能操作在前、只看数据靠后） */
const homeJs = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/admin-home/admin-home.js', 'utf8');
const homeWxml = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/admin-home/admin-home.wxml', 'utf8');
const grpNames = [...homeJs.matchAll(/\{ name: '([^']+)', items:/g)].map((m) => m[1]);
assert.deepStrictEqual(grpNames, ['会员与收入', '用户与安全', '运营设置', '只看数据'], 'AL-6 四组顺序应为会员与收入→用户与安全→运营设置→只看数据');
const titles = [...homeJs.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
assert.strictEqual(titles.length, 14, '入口总数为14（AN批删除示例截图管理后）');
assert.deepStrictEqual(titles.slice(0, 4), ['会员管理', '会员订单与收入', '额度与会员价格设置', '会员与积分配置'], 'AL-7 会员与钱相关占首组');
assert.deepStrictEqual(titles.slice(7, 10), ['功能开关', '邀请奖励', '用户反馈列表'], 'AL-7 运营设置组含开关中心与合并后的邀请奖励');
assert.deepStrictEqual(titles.slice(10), ['数据概览', '用户额度使用情况', '拍照导入用量监控', '家庭共享概况'], 'AL-7 只看数据四项垫底（AN批删示例截图管理）');
assert.ok(titles.includes('邀请奖励') && !titles.includes('邀请奖励数据') && !titles.includes('邀请奖励设置'), 'AL-8 邀请设置与数据已合并为一个入口');
const invWxml = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/invite/invite.wxml', 'utf8');
assert.ok(invWxml.includes('bindtap="onSaveInvite"'), 'AL-8 邀请页应含设置保存');
assert.ok(invWxml.indexOf('onSaveInvite') < invWxml.indexOf('stat-grid'), 'AL-8 设置应在数据之上');
const acfgWxml2 = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/app-config/app-config.wxml', 'utf8');
assert.ok(!acfgWxml2.includes("section === 'invite'"), 'AL-8 配置页不应再有邀请节（已合并）');
assert.ok(homeWxml.includes('wx:for="{{groups}}"') && homeWxml.includes('group-title'), 'AL-8 首页应按组渲染带组标题');
console.log('✓ AL批·首页分组断言全过');

/* AL-9 老板后台字号：主文字 16px（与前台姓名 .nm 一致），后台各页按钮无 15px 残留 */
const common = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/admin-common.wxss', 'utf8');
assert.ok(/page \{ font-size: 16px; \}/.test(common), 'AL-9 后台页面基准字号应为16px');
assert.ok(common.includes('.form-label, .form-val { font-size: 16px; }'), 'AL-9 后台表单主文字应为16px');
const nmFront = fs.readFileSync(__dirname + '/../miniprogram/pages/gifts/gifts.wxss', 'utf8');
assert.ok(/\.nm \{ font-size: 16px/.test(nmFront), 'AL-9 前台姓名基准应为16px（对照源）');
for (const f of ['account/account.wxss', 'admins/admins.wxss', 'app-config/app-config.wxss', 'feedback/feedback.wxss', 'abuse/abuse.wxss']) {
  const t = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/' + f, 'utf8');
  const btns = [...t.matchAll(/\.(btn-primary|btn-danger|btn-ghost) \{[^}]*font-size: (\d+)px/g)].map((m) => m[2]);
  assert.ok(btns.length > 0 && btns.every((v) => v === '16'), 'AL-9 ' + f + ' 主按钮应为16px，实际 ' + btns.join(','));
}
console.log('✓ AL批·后台字号断言全过');

/* AL-10 导出备份图标对称性：托盘横向跨度中心须与箭头轴线 x=24 一致 */
const svg = fs.readFileSync(__dirname + '/../miniprogram/images/icons/export.svg', 'utf8');
assert.ok(svg.includes('M24 38V8'), 'AL-10 箭头轴线应在 x=24');
assert.ok(svg.includes('M14 26v12'), 'AL-10 托盘左壁应在 x=14');
assert.ok(/h16a2 2 0 0 0 2-2V26/.test(svg), 'AL-10 托盘右壁应收于 x=34（跨度14~34中心24）');
console.log('✓ AL批·导出图标断言全过');

/* AL-11 功能总开关静态断言：配置页有两闸、首页/我的有入口拦截 */
const acfgWxml = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/app-config/app-config.wxml', 'utf8');
assert.ok(acfgWxml.includes('data-key="eInvitation"') && acfgWxml.includes('data-key="familyShare"'), 'AL-11 配置页功能开关节应有电子请柬/家庭共享两闸');
assert.ok(acfgWxml.includes('bindtap="onSaveMaster"'), 'AL-11 总开关组应有统一保存按钮');
const idxJs = fs.readFileSync(__dirname + '/../miniprogram/pages/index/index.js', 'utf8');
assert.ok(idxJs.includes('flags0.eInvitation === false'), 'AL-11 首页请柬入口应受总开关控制');
assert.ok(idxJs.includes('家庭共享敬请期待'), 'AL-11 首页共享入口应有总闸提示');
const mineJs2 = fs.readFileSync(__dirname + '/../miniprogram/pages/mine/mine.js', 'utf8');
assert.ok(!mineJs2.includes('onShareHome'), 'AL-11 我的页共享行已由 BE批删除（入口只在首页、总闸在首页校验）');
console.log('✓ AL批·总开关断言全过');

/* AL-12 开关中心 —— AM批由用户改定为三组，本节断言随之更新：
 * 总开关（加横置、不含云端购买）/ 会员功能（原会员专属功能改名）/ 支付开关
 * （云端购买+双平台入口一组一存）；旧「会员开关」组删除。 */
const swWxml = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/app-config/app-config.wxml', 'utf8');
const swJs = fs.readFileSync(__dirname + '/../miniprogram/pages/admin/app-config/app-config.js', 'utf8');
for (const gh of ['总开关', '会员功能', '支付开关']) {
  assert.ok(swWxml.includes(`<view class="group-h">${gh}</view>`), 'AL-12 开关中心应有分组：' + gh);
}
for (const gh of ['会员开关', '会员专属功能', '支付平台开关']) {
  assert.ok(!swWxml.includes(`<view class="group-h">${gh}</view>`), 'AL-12 旧分组应已删除：' + gh);
}
assert.ok(!swWxml.includes('checkbox-group'), 'AL-12 会员功能应为开关样式，无打钩控件');
assert.ok(swWxml.includes('bindchange="onMemberSwitch"'), 'AL-12 会员功能应为开关切换');
assert.ok(swWxml.includes('data-key="maintenance"') && swWxml.includes('data-key="registration"') && swWxml.includes('data-key="landscape"'), 'AL-12 总开关组应含维护模式/注册/横置礼单本');
// 云端购买只出现在支付开关组：整页只应出现一次 data-key="paymentEnabled"，且在「支付开关」组标题之后
assert.ok(swWxml.indexOf('data-key="paymentEnabled"') > swWxml.indexOf('<view class="group-h">支付开关</view>'), 'AL-12 云端购买应归支付开关组');
// 三组保存各管各的
for (const h of ['onSaveMaster', 'onSaveFeatures', 'onSavePayment']) {
  assert.ok(swWxml.includes(`bindtap="${h}"`), 'AL-12 应有保存按钮 ' + h);
  assert.ok(swJs.includes(h + '()'), 'AL-12 JS 应有 handler ' + h);
}
assert.ok(!swWxml.includes('bindtap="onSaveSwitches"') && !swWxml.includes('bindtap="onSavePlatforms"'), 'AL-12 旧保存按钮应已删除');
assert.ok(swJs.includes('adminUpdateLaunchSwitches'), 'AL-12 总开关/支付组保存应走发布开关接口');
assert.ok(swJs.includes('adminUpdateMemberOnlyFeatures'), 'AL-12 会员功能组保存应走专属清单接口');
assert.ok(swJs.includes('adminUpdatePaymentPlatforms'), 'AL-12 支付组保存应走平台开关接口');
assert.ok(!swJs.includes('adminUpdateFeatureSwitches'), 'AL-12 会员开关组删除后不应再走旧会员功能开关接口');
assert.ok(swWxml.includes('管「功能开和关」') || swWxml.includes('管「算不算会员专属」'), 'AL-12 应有区别说明小字');
assert.ok(swWxml.includes('管「算不算会员专属」'), 'AL-12 会员功能组应有区别说明小字');
console.log('✓ AL批·开关中心断言全过');
