/** CQ批（用户 2026-10-29 定）：横置礼单莫大毛笔与枝芒行书再大一点。
 * 校准系数各 +0.08（沿用 2026-10-27 枝芒大一号的步长）：枝芒 1.24→1.32，
 * 莫大 1.12→1.20；其余四款不动。布局自带防叠字（放不下时宁可缩小），
 * 故加大不会叠字；中段贺礼/奠仪用固定宋体，不受校准影响。 */
const { test, assert } = require('./fw');
const LC = require('../miniprogram/pages/landscape/landscape-core.js');

test('CQ 莫大与枝芒校准加大、其余不动', () => {
  const byId = {};
  for (const f of LC.FONTS) byId[f.id] = f;
  assert.eq(byId.zhimang.calibration, 1.32, '枝芒 1.24→1.32');
  assert.eq(byId.bakudai.calibration, 1.20, '莫大 1.12→1.20');
  assert.eq(byId.lxgw.calibration, 1.00, '霞鹜不动');
  assert.eq(byId.mashanzheng.calibration, 1.05, '马善政不动');
  assert.eq(byId.longcang.calibration, 1.20, '龙藏不动');
  assert.eq(byId.cactus.calibration, 1.00, '古典不动');
});
