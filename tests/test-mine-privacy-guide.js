/** 登录与"我的"页面线（任务Q2）：
 * - 隐私页面层守卫：未同意拦截 chooseAvatar/拍照导入、同意后放行、非隐私动作不拦
 * - 隐私弹窗首次判定：没展示过且后端未同意才弹
 * - 引导只显示一次：标记后不再进；关于页重看走 review 模式
 * - "我的"页行序（源码断言）：资料条→会员积分卡→共享/横置/导出→邀请分享→通知组→底部，
 *   且没有独立"分享转发"行、导出行下有逐字提示
 * - 邀请页：标题「邀请分享」、右上角分享路径带邀请码
 * - 首页：失败重试条文案/调用、隐私弹窗组件接线；资料页：微信头像/昵称能力 */
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./fw');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const privacyGuard = require('../miniprogram/services/privacy-guard');
const guideState = require('../miniprogram/services/guide-state');

function fakeStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : ''), set: (k, v) => m.set(k, v) };
}

test('隐私守卫：未同意时拦截 chooseAvatar 与拍照导入', async () => {
  for (const action of ['chooseAvatar', 'photoImport']) {
    const v = privacyGuard.evaluate({ agreed: false }, action);
    assert(v.allowed === false && v.needPopup === true, `${action} 未同意应拦截并要求弹窗`);
  }
  assert(privacyGuard.isPrivacyAction('chooseAvatar') && privacyGuard.isPrivacyAction('photoImport'), '两个隐私动作在册');
});

test('隐私守卫：同意后放行，非隐私动作（记账浏览）从不拦', async () => {
  assert(privacyGuard.evaluate({ agreed: true }, 'chooseAvatar').allowed === true, '同意后选头像放行');
  assert(privacyGuard.evaluate({ agreed: true }, 'photoImport').allowed === true, '同意后拍照导入放行');
  for (const action of ['browse', 'addRecord', 'exportExcel', '']) {
    const v = privacyGuard.evaluate({ agreed: false }, action);
    assert(v.allowed === true && v.needPopup === false, `非隐私动作 ${action || '(空)'} 不拦`);
  }
});

test('隐私弹窗首次判定：只在"没展示过且后端未同意"时弹', async () => {
  assert(privacyGuard.needsFirstPopup({ localShown: false, backendAgreed: false }) === true, '首次未同意 → 弹');
  assert(privacyGuard.needsFirstPopup({ localShown: true, backendAgreed: false }) === false, '弹过一次 → 不再弹');
  assert(privacyGuard.needsFirstPopup({ localShown: false, backendAgreed: true }) === false, '后端已同意 → 不弹');
  assert(privacyGuard.needsFirstPopup({ localShown: true, backendAgreed: true }) === false, '都满足 → 不弹');
  const s = fakeStorage();
  assert(privacyGuard.readPopupShown(s) === false, '新 storage 无标记');
  privacyGuard.markPopupShown(s);
  assert(privacyGuard.readPopupShown(s) === true, '标记落 storage');
});

test('引导只显示一次：标记后不再进入，步进不越界', async () => {
  const s = fakeStorage();
  assert(guideState.readSeen(s) === false, '新用户没看过');
  let entry = guideState.resolveGuideEntry({ seen: guideState.readSeen(s) });
  assert(entry.enter === true && entry.review === false, '首次 → 进入引导');
  guideState.markSeen(s);
  entry = guideState.resolveGuideEntry({ seen: guideState.readSeen(s) });
  assert(entry.enter === false, '标记后 → 不再进入');
  assert(guideState.nextStep(0) === 1 && guideState.nextStep(1) === 2, '步进前进');
  assert(guideState.nextStep(2) === 2 && guideState.isLastStep(2) && !guideState.isLastStep(1), '末屏不越界');
});

test('引导重看模式：从关于我们进入恒为 review，与已看标记无关', async () => {
  assert(guideState.resolveGuideEntry({ seen: true, from: 'about' }).review === true, '已看过也能重看');
  assert(guideState.resolveGuideEntry({ seen: false, from: 'about' }).enter === true, '重看恒进入');
  const guideJs = read('miniprogram/pages/guide/guide.js');
  assert(guideJs.includes('if (!this.data.review) guideState.markSeen()'), '只有非重看才落已看标记');
  const aboutJs = read('miniprogram/pages/mine/about.js');
  assert(aboutJs.includes('/pages/guide/guide?from=about'), '关于页带 from=about 重看');
  const aboutWxml = read('miniprogram/pages/mine/about.wxml');
  assert(aboutWxml.includes('使用引导'), '关于页有「使用引导」行');
});

test('"我的"页行序：资料条→会员积分卡→横置→邀请分享→通知组→底部（BE批取消家庭共享行）', async () => {
  // 剥掉注释再断言（头注释里复述了顺序，会污染 indexOf）
  const wxml = read('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const markers = [
    'bindtap="onProfile"',   // ① 个人资料条
    '会员与积分',             // ② 会员与积分卡片
    '横置礼单本',             // ③
    '邀请分享',               // ④ 唯一入口
    '通知',                   // ⑤
    '意见反馈',               // ⑤
    '常见问题',               // ⑤
    '关于我们',               // ⑤
    '联系客服',               // ⑤
    '隐私政策',               // ⑥ 底部
    '注销账号',               // ⑥ 底部
    '{{version}}',            // ⑥ 版本号在最底部
  ];
  let last = -1;
  for (const m of markers) {
    const i = wxml.indexOf(m);
    assert(i > last, `行序错误：「${m}」应出现在上一项之后（index=${i}, last=${last}）`);
    last = i;
  }
  assert(!wxml.includes('分享转发'), '不得再有独立"分享转发"行');
  const mineJs = read('miniprogram/pages/mine/mine.js');
  assert(!/onShare\s*\(\s*\)/.test(mineJs) && !mineJs.includes('分享转发（待接入）') && !mineJs.includes('onShareHome'), 'mine.js 不得留分享转发处理函数');
  assert(wxml.includes('open-type="contact"'), '联系客服是微信客服按钮（open-type=contact）');
  assert(wxml.includes('已邀请 {{inviteDone}}/{{inviteMax}}'), '邀请行显示已邀请 x/上限（x 读数据）');
  assert(wxml.includes('{{displayName}}') && !wxml.includes('>我<'), '资料条显示昵称且不再写死"我"');
});

test('邀请页合并：标题「邀请分享」，分享走 inviter 参数链接（任务Z 去码化）', async () => {
  const j = JSON.parse(read('miniprogram/pages/invite/invite-reward.json'));
  assert(j.navigationBarTitleText === '邀请分享', '页面标题为邀请分享');
  const js = read('miniprogram/pages/invite/invite-reward.js');
  assert(js.includes('onShareAppMessage'), '有右上角分享');
  assert(js.includes('/pages/index/index?inviter='), '分享路径带 inviter 参数（用户不可见，任务Z 第 5 项）');
  assert(!js.includes('inviteCode='), '不得再用 inviteCode 参数');
});

test('首页接线：重试条 + 隐私弹窗 + 拍照前守卫', async () => {
  const wxml = read('miniprogram/pages/index/index.wxml');
  assert(wxml.includes('网络不太顺，点这里重试'), '重试条文案逐字');
  assert(wxml.includes('<privacy-modal'), '首页挂了隐私弹窗组件');
  const json = JSON.parse(read('miniprogram/pages/index/index.json'));
  assert(json.usingComponents && json.usingComponents['privacy-modal'], 'index.json 注册隐私弹窗组件');
  const js = read('miniprogram/pages/index/index.js');
  assert(js.includes('retryInit'), '重试条调用 app.retryInit');
  assert(js.includes("privacyGuard.evaluate({ agreed }, 'photoImport')"), '拍照进入前过隐私守卫');
  assert(js.includes('setPrivacyConsent(true)'), '点同意落库同意状态');
  assert(js.includes('guideState.resolveGuideEntry'), '首次先判定引导');
});

test('个人资料页：微信选头像/昵称输入能力 + 隐私守卫 + 上限读配置', async () => {
  const wxml = read('miniprogram/pages/mine/profile.wxml');
  assert(wxml.includes('open-type="chooseAvatar"'), '头像用微信 chooseAvatar 按钮');
  assert(wxml.includes('type="nickname"'), '昵称用微信 nickname 输入框');
  assert(wxml.includes('<privacy-modal'), '资料页挂隐私弹窗（选头像前守卫）');
  const js = read('miniprogram/pages/mine/profile.js');
  assert(js.includes("privacyGuard.evaluate({ agreed: !!(c && c.agreed) }, 'chooseAvatar')") || js.includes("'chooseAvatar'"), '进入选头像前过守卫判定');
  assert(js.includes('AppConfig.profile') && js.includes('nicknameMaxLen'), '昵称上限读配置不写死');
  assert(js.includes('updateProfile'), '保存走 data-service.updateProfile');
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert(appJson.pages.includes('pages/mine/profile'), 'app.json 注册个人资料页');
  assert(appJson.pages.includes('pages/guide/guide'), 'app.json 注册引导页');
});

test('隐私弹窗组件：含同意/不同意与双协议链接', async () => {
  const wxml = read('miniprogram/components/privacy-modal/privacy-modal.wxml');
  for (const t of ['隐私政策与用户协议', '《隐私政策》', '《用户协议》', '同意', '不同意']) {
    assert(wxml.includes(t), `弹窗应含「${t}」`);
  }
  const js = read('miniprogram/components/privacy-modal/privacy-modal.js');
  for (const ev of ['agree', 'disagree', 'privacy', 'agreement']) {
    assert(js.includes(`triggerEvent('${ev}')`), `弹窗应抛出 ${ev} 事件`);
  }
});

test('任务AE：我的页无导出备份入口（只留首页）；横置开关只拦开不拦关', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml').replace(/<!--[\s\S]*?-->/g, '');
  assert(!wxml.includes('导出备份'), '我的页不得再有导出备份行（入口只在首页金刚区）');
  assert(!wxml.includes('onExport'), '我的页不得再绑定 onExport');
  const mineJs = read('miniprogram/pages/mine/mine.js');
  assert(!/onExport\s*\(/.test(mineJs), 'mine.js 不得留 onExport 方法');
  const i = mineJs.indexOf('onLandscapeToggle()');
  assert(i >= 0, '应有 onLandscapeToggle');
  const body = mineJs.slice(i, i + 1000);
  const nextPos = body.indexOf('const next = !this.data.landscapeOn;');
  // AM批两道闸：总开关+会员功能名单，仍只在 next 为开时触发（关不验会员）
  const gatePos = body.indexOf('if (next) {');
  const memberPos = body.indexOf('landOnly && !this.data.isMember');
  assert(nextPos >= 0 && gatePos > nextPos && memberPos > gatePos, '应先算 next，两道闸只在 next 为开时触发（关不验会员）');
});

test('任务AE：我的页字体统一 16px（=亲友录联系人姓名 .nm 大小）且上下紧凑', async () => {
  const contactsWxss = read('miniprogram/pages/contacts/contacts.wxss');
  assert(/\.nm \{ font-size: 16px; \}/.test(contactsWxss), '基准：亲友录联系人姓名为 16px');
  const wxss = read('miniprogram/pages/mine/mine.wxss');
  // AS批定版例外：「添加到我的小程序」红条文案缩短后在窄屏仍放不下，
  // 按用户任务书降到 15px 单行显示——仅此一处豁免，其余仍只许 16/22。
  assert(/\.addmp-bar \{[^}]*font-size: 15px/.test(wxss), 'AS批红条定版 15px（单行放下）');
  // BA批例外：教程层是按竞品视频复刻的微信界面模拟（步骤 15px、面板小字
  // 12/13px），不是本页正文排版，不纳入 AE 的页面字号规则；该段自
  // 「BA批教程层」注释起至文件尾，扫描前整段剔除（BA批自有断言把守）。
  const wxssNoBar = wxss.replace(/\.addmp-bar \{[^}]*\}/, '')
    .replace(/\/\* BA批教程层[\s\S]*$/, '');
  const sizes = [...wxssNoBar.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  const bad = sizes.filter((s) => s !== 16 && s !== 22);
  assert(bad.length === 0, `我的页 font-size 只许 16（文字）与 22（头像首字图形），实际异常值：${bad.join(',')}`);
  // 22 只许出现在头像首字
  const avatarBlock = wxss.slice(wxss.indexOf('.avatar-initial'), wxss.indexOf('.profile-chev'));
  assert(avatarBlock.includes('font-size: 22px'), '头像首字保留 22px（图形占位，非正文）');
  assert(wxss.includes('.form-val { font-size: 16px; }'), '功能行文字页面级覆盖为 16px');
  // 紧凑锚点
  assert(wxss.includes('.profile { padding: 12px 16px;'), '资料条上下内边距收到 12px');
  assert(wxss.includes('.card { margin: 8px 12px; }'), '卡间距页面级收紧为上下 8px');
  assert(wxss.includes('.form-row { min-height: 50px; }'), '功能行高收到 50px（不低于 48 可点下限）');
});

test('任务AE 补漏：我的页 wxml 内联字号也不许小于 16（版本号曾是内联 11px）', async () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml');
  const inline = [...wxml.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert(inline.every((s) => s === 16), `内联字号应全为 16，实际：${inline.join(',')}`);
});
