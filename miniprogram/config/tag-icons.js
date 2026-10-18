/**
 * 标签图案唯一映射（总指挥重画图案前的收口）
 *
 * 规矩：全产品任何地方要用 10 个标签图案，一律调 tagIconPath(tagId)，
 * 不许自己拼 '/icons/' + 文件名（tests/test-amount-scan.js 的同类思想，
 * 图案无扫描测试，靠 code review 守）。
 *
 * 换图案流程：总指挥交付 10 个新 SVG → 只替换 miniprogram/icons/ 下的
 * 10 个文件（文件名保持 01-jiehun.svg … 10-qita.svg 不变）→ 页面代码不动。
 * 已做到"换文件即换图案"。
 */
const TAG_ICON_PATHS = {
  jiehun: '/icons/01-jiehun.svg',
  shengzi: '/icons/02-shengzi.svg',
  tanwang: '/icons/03-tanwang.svg',
  yasui: '/icons/04-yasui.svg',
  shengri: '/icons/05-shengri.svg',
  shengxue: '/icons/06-shengxue.svg',
  qiaoqian: '/icons/07-qiaoqian.svg',
  dashou: '/icons/08-dashou.svg',
  baishi: '/icons/09-baishi.svg',
  qita: '/icons/10-qita.svg',
};

/**
 * 标签 id → 图案文件路径；未知 id 回退到"其他"
 * @param {string} tagId
 * @returns {string} 如 '/icons/01-jiehun.svg'
 */
function tagIconPath(tagId) {
  return TAG_ICON_PATHS[tagId] || TAG_ICON_PATHS.qita;
}

module.exports = { TAG_ICON_PATHS, tagIconPath };
