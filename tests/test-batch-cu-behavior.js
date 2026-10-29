/** CU批（用户 2026-10-29 定，做能做的那个）：我的页红幅不再每次提醒，
 * 只在第一次打开显示——本地记标记 addMpGuideShown，之后不再显示；
 * 整个删除重进会清标记、自然再提醒。微信不提供查常用接口，从常用/
 * 我的小程序里删无法检出，故只做第一次显示（取代 AS批每次显示；
 * 旧 addMpGuideDone 仍不得读写）。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CU 我的页红幅只第一次显示', () => {
  const js = readMp('pages/mine/mine.js');
  assert(js.includes("getStorageSync('addMpGuideShown')"), 'onLoad 读首次标记');
  assert(js.includes("setStorageSync('addMpGuideShown'"), '首次显示即记标记');
  assert(!js.includes("getStorageSync('addMpGuideDone'") && !js.includes("setStorageSync('addMpGuideDone'"), '旧永久标记仍不得读写');
  const onShow = js.slice(js.indexOf('async onShow()'), js.indexOf('onHide() {'));
  assert(!onShow.includes('addMpGuideShow'), 'onShow 不再改红幅（避免首进显示被覆盖）');
  assert(js.includes('addMpGuideShow: false, // 「添加到我的小程序」引导条（CU批定版'), '红幅默认关闭、只由首次标记打开');
});
