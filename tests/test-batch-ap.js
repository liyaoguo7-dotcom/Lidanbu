/* AP批静态断言：攒批六项接线与文案逐项核（文案一字不差类断言） */
const assert = require('node:assert');
const fs = require('node:fs');
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');
const has = (p) => fs.existsSync(__dirname + '/../' + p);

/* AP-1 共享邀请页：按钮同步重算 + 文案两处 */
const invWxml = rd('miniprogram/pages/share/share-invite.wxml');
const invJs = rd('miniprogram/pages/share/share-invite.js');
assert.ok(invJs.includes('canInvite'), 'AP-1 邀请页应有 canInvite 本地状态');
assert.ok(invJs.includes('_syncBtnState(events, this.data.giftsOn)'), 'AP-1 礼薄勾选应同步重算按钮');
assert.ok(invJs.includes('_syncBtnState(this.data.events, giftsOn)'), 'AP-1 送礼勾选应同步重算按钮');
assert.ok(invWxml.includes('disabled="{{!canInvite}}"'), 'AP-1 按钮 disabled 应绑 canInvite 而非 inviteCode');
assert.ok(invWxml.includes('被邀请人的操作权限'), 'AP-1 权限组标题应改为「被邀请人的操作权限」');
assert.ok(invWxml.includes('（勾上哪项，被邀请人就能对你共享的记录做哪项操作）'), 'AP-1 权限组应有括号解释小字');
assert.ok(!invWxml.includes('允许查看我标记的项目'), 'AP-1 邀请页不应再有旧标题「允许查看我标记的项目」');
assert.ok(invWxml.includes('共享范围（至少选一项；你选中的礼薄和送礼记录，被邀请人都能看到）'), 'AP-1 共享范围括号说明应补全');

/* AP-2 共享首页：黄条移到两行入口上方，文案不动 */
const homeWxml = rd('miniprogram/pages/share/share-home.wxml');
assert.ok(homeWxml.includes('邀请家人共记一本账：允许查看我标记的项目，权限由你定，随时可改、立即生效。'), 'AP-2 黄条文案不动');
assert.ok(homeWxml.indexOf('class="tip"') < homeWxml.indexOf('class="card"'), 'AP-2 黄条应在入口卡片之前（页面顶部）');

/* AP-3 标语投放：四处文案一字不差 */
const idxWxml = rd('miniprogram/pages/index/index.wxml');
const idxJs = rd('miniprogram/pages/index/index.js');
['今年你送出去了多少礼？', '出门在外，想查往来却找不到礼簿？', '纸质礼簿越记越厚，翻找一笔好费劲？']
  .forEach((s) => assert.ok(idxJs.includes(s), `AP-3 首页标语应含「${s}」`));
assert.ok(idxWxml.includes('点底部记第一笔，人情往来更轻松'), 'AP-3 首页标语块应有固定行动行');
assert.ok(idxWxml.includes('recent.length === 0'), 'AP-3 标语块只在最近往来为空时显示');
assert.ok(idxJs.includes('setInterval') && idxJs.includes('clearInterval'), 'AP-3 轮播定时器应有启停');
assert.ok(idxJs.includes('_stopSlogan') && idxJs.includes('onHide()') && idxJs.includes('onUnload()'), 'AP-3 离页应清定时器');
assert.ok(idxJs.includes("url: '/pages/gift-add/gift-add'"), 'AP-3 标语块点击应跳添加送礼页');
assert.ok(rd('miniprogram/pages/gifts/gifts.wxml').includes('今年你送出去了多少礼？'), 'AP-3 送礼空状态应加标语');
assert.ok(rd('miniprogram/pages/contacts/contacts.wxml').includes('出门在外，想查往来却找不到礼簿？'), 'AP-3 亲友录空状态应加标语');
assert.ok(!invWxml.includes('纸质礼簿越记越厚，翻找一笔好费劲？'), 'AZ改定：邀请页顶部标语已撤（标语移至共享首页）');

/* AP-4 往来页：版式数值 + 排序比较器 */
const wlWxss = rd('miniprogram/pages/wanglai/wanglai.wxss');
assert.ok(wlWxss.includes('padding: 6px 12px 2px'), 'AP-4 时间行顶部 padding 应 10px→6px（整体上移）');
assert.ok(wlWxss.includes('.searchbar { padding: 4px 12px; }'), 'AP-4 搜索框行与全部时间距离应缩小（本页覆盖）');
assert.ok(wlWxss.includes('margin: 10px 12px 0'), 'AP-4 对照卡与头部区应留独立灰隔（margin-top 4px→10px）');
assert.ok(wlWxss.includes('padding: 13px 16px'), 'AP-4 联系人行上下 padding 应 9px→13px');
const stats = rd('core/stats.js');
assert.ok(stats.includes('lastDate'), 'AP-4 stats 应跟踪 lastDate');
assert.ok(/a\.lastDate < b\.lastDate/.test(stats), 'AP-4 排序比较器应以 lastDate 为第一键');

/* AP-5 顶部条形弹窗组件 */
['js', 'json', 'wxml', 'wxss'].forEach((ext) => assert.ok(has(`miniprogram/components/top-banner/top-banner.${ext}`), `AP-5 top-banner 应有 .${ext}`));
const tbJs = rd('miniprogram/components/top-banner/top-banner.js');
assert.ok(tbJs.includes('topBannerShownTick'), 'AP-5 出现规则已由 AS批改版：App 前台化周期 tick（原模块级 shownThisLaunch 已废）');
assert.ok(tbJs.includes('3500'), 'AP-5 停留时长暂定 3.5 秒');
assert.ok(rd('miniprogram/components/top-banner/top-banner.wxml').includes('『人情礼单簿』小程序提供服务'), 'AP-5 胶囊文案应为我们的小程序名');
assert.ok(rd('miniprogram/pages/index/index.json').includes('top-banner'), 'AP-5 首页应注册 top-banner');
assert.ok(idxWxml.includes('<top-banner'), 'AP-5 首页应挂 top-banner');

/* AP-6 我的页「添加到我的小程序」引导 */
const mineWxml = rd('miniprogram/pages/mine/mine.wxml');
const mineJs = rd('miniprogram/pages/mine/mine.js');
assert.ok(mineWxml.includes('点击[添加到我的小程序]，下次打开更快捷'), 'AP-6 顶部红条文案');
assert.ok(mineWxml.includes('点击屏幕右上角的三个点'), 'AP-6 教程第 1 步');
assert.ok(mineWxml.includes('点击『添加到我的小程序』'), 'AP-6 教程第 2 步');
assert.ok(mineWxml.includes('在微信首页往下拉，就能快速打开『人情礼单簿』'), 'AP-6 教程第 3 步（我们的名称）');
assert.ok(mineWxml.includes('我知道了'), 'AP-6 教程底部按钮');
assert.ok(mineWxml.includes('addmp-mock-avatar') && mineWxml.includes('人情礼单簿'), 'AP-6 示意小图应为我们的头像与名称');
assert.ok(!mineJs.includes("setStorageSync('addMpGuideDone'") && !mineJs.includes("getStorageSync('addMpGuideDone'"), 'AP-6 永久标志已由 AS批定版删除：不得再读写 addMpGuideDone');
assert.ok(mineJs.includes('addMpGuideShow: true'), 'AS批定版：进我的页即显示引导条（onLoad 置 true）');

console.log('✓ AP批·接线静态断言全过');
