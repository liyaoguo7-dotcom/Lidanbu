/**
 * 礼单簿 · 购买页视图模型（纯函数，无 wx 依赖，页面与测试共用）
 *
 * 购买页（pages/member/purchase）只负责把这里算好的视图渲染出来：
 * - 套餐只显示上架档位（onShelf=false 的一键下架档不出现）；
 * - 积分礼包对非会员整体置灰（locked），点按只给引导，不发起购买；
 * - 平台购买开关关闭时 buyEnabled=false，页面隐藏全部购买按钮、
 *   改显配置里的大白话提示——开关逻辑不在页面里写死。
 * isMember 口径与"我的"页一致：member / grace 都算会员。
 */
function isMemberState(state) {
  return state === 'member' || state === 'grace';
}

/**
 * @param {{plans:Array, packs:Array, state:string, purchaseEnabled:boolean}} input
 *   plans/packs 为 data-service 已格式化的展示形状（带 priceText）
 * @returns {{plans:Array, packs:Array, packsLocked:boolean, buyEnabled:boolean, isMember:boolean}}
 */
function buildPurchaseView({ plans = [], packs = [], state = 'free', purchaseEnabled = true } = {}) {
  const isMember = isMemberState(state);
  return {
    plans: plans.filter((p) => p.onShelf !== false),
    packs: packs.map((p) => ({ ...p, locked: !isMember })),
    packsLocked: !isMember,
    buyEnabled: purchaseEnabled !== false,
    isMember,
  };
}

module.exports = { buildPurchaseView, isMemberState };
