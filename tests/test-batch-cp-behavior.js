/** CP批（用户 2026-10-29 定）：往来收礼/送礼两块颜色一比一复刻首页
 * 两大卡——只复刻底色渐变，方块大小、间距、圆角、文字色都不动，
 * 阴影不抄。按角色复刻：收礼 ← 首页收礼橙黄渐变，送礼 ← 首页送礼
 * 粉红渐变。CS批后两块位置对换为左送礼、右收礼，故往来左右浓淡
 * 顺序与首页一致（左淡右浓），本文件旧“左右相反”备注作废。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('CP 往来收送颜色一比一复刻首页', () => {
  const wl = readMp('pages/wanglai/wanglai.wxss');
  const idx = readMp('pages/index/index.wxss');
  const grad = (css, cls) => {
    const m = css.match(new RegExp(`\\${cls} \\{[^}]*background: (linear-gradient\\([^)]+\\));`));
    assert(m, `首页应有 ${cls} 渐变`);
    return m[1];
  };
  const giftGrad = grad(idx, '.bigcard.gift');
  const receiveGrad = grad(idx, '.bigcard.receive');
  assert.eq(giftGrad, 'linear-gradient(135deg, #FFC7C3, #F78C8F)', '首页送礼为淡粉渐变（左）');
  assert.eq(receiveGrad, 'linear-gradient(135deg, #FFE4B8, #FDBE68)', '首页收礼为浓橙渐变（右）');
  assert(wl.includes(`.side:first-child { background: ${giftGrad}; }`), '往来送礼块（CS批左）＝首页送礼渐变');
  assert(wl.includes(`.side:last-child { background: ${receiveGrad}; }`), '往来收礼块（CS批右）＝首页收礼渐变');
  const side = wl.slice(wl.indexOf('.side {'), wl.indexOf('.side-label {'));
  assert(side.includes('border-radius: 12px;'), '方块圆角不动');
  assert(!side.includes('box-shadow'), '阴影不抄');
  const compare = wl.slice(wl.indexOf('.compare {'), wl.indexOf('.summary-card {'));
  assert(compare.includes('gap: 12px;'), '方块间距不动');
});
