/**
* 礼单簿 · 支付适配层（任务K）
*
* 统一接口（页面与业务层只认这组方法，不感知具体通道）：
* createOrder(order) 在支付通道侧建单，返回 {channelTradeNo}
* requestPay(order) 调起支付，返回 {status:'success'|'fail'|'cancel', amountFen}
* buildNotify(order,result) 由支付结果组装一条"回调原始报文"（模拟异步回调时用）
* handleNotify(raw) 把通道回调原始报文归一化为 {outTradeNo, amountFen, paid}
* refund(order) 退款（占位，真实退款待通道接入）
*
* 通道实现：
* - MockPayAdapter：模拟支付。结果可配置（成功/失败/取消）；purchase 流程
* 在 requestPay 成功后走 buildNotify → payment.processNotify 的异步回调
* 路径（与真实通道"前端回调不算数、服务端发货推送为准"同构）；
* 可注入重复回调验证幂等（见 payment.purchase 的 duplicateNotify 选项）。
* - WechatVirtualPayAdapter：微信虚拟支付骨架，只写接口形状与 TODO，
* 真实支付不接。依据 docs/T0.3 结论：会员收费属虚拟商品，必须走官方
* 小程序虚拟支付"道具直购"（wx.requestVirtualPayment），发货以平台
* 发货推送（xpay_goods_deliver_notify）为准、query_order 查单兜底，
* 前端支付回调不作为发货依据。
* ★个人主体虚拟支付新政（2026-10-20 官方文档《虚拟支付：个人》核实）：
* 个人主体 + 服务类目含「工具」+ 完成认证、备案即可开通，月支付限额
* 10 万元，费率安卓 1%（腾讯技术服务费）/ iOS 12%（Apple 佣金），
* 结算安卓 T+3、iOS 约 45–60 天。个人与企业/个体户两种主体共用本
* 适配接口，切换主体只换配置（OfferID/AppKey/道具 ID），业务代码不动。
*/
const errors = require('./errors');

function notImplemented(what) {
const e = new Error(errors.userMessage('pay-not-implemented'));
e.code = 'pay-not-implemented';
e.detail = what;
return e;
}

/** 模拟支付适配器：结果可配置，专供本地演示与自动化测试 */
class MockPayAdapter {
/**
* @param {{result?:'success'|'fail'|'cancel'}} [opts] requestPay 的模拟结果
*/
constructor(opts = {}) {
this.channel = 'mock';
this.result = opts.result || 'success';
}

async createOrder(order) {
return { channel: this.channel, channelTradeNo: `mock_${order.outTradeNo}`};
}

/** 模拟用户在收银台的操作结果：success=付了，fail=支付失败，cancel=中途取消 */
async requestPay(order) {
return { status: this.result, amountFen: order.amountFen};
}

/** 把支付结果组装成回调原始报文（模拟平台异步回调的入参形状） */
buildNotify(order, result) {
return {
outTradeNo: order.outTradeNo,
amountFen: order.amountFen,
paid:!!result && result.status === 'success',
channel: this.channel,
};
}

/** 归一化：mock 报文与标准形状一致，原样透传三要素 */
handleNotify(raw = {}) {
return {
outTradeNo: raw.outTradeNo,
amountFen: raw.amountFen,
paid:!!raw.paid,
};
}

/** 退款占位：不真退，只回执"已受理（占位）"，状态与会员回收由 payment.refund 处理 */
async refund(order) {
return { ok: true, placeholder: true, channelTradeNo: `mock_refund_${order.outTradeNo}`};
}
}

/**
* 微信虚拟支付适配器（骨架，未接真实支付）。
* 云环境与商户配置（OfferID / 现网 AppKey / 道具 ID）到位后，只改本类
* 实现，payment.js 与页面不动。签名两套：paySig（AppKey 对
* "requestVirtualPayment&signData" 做 HMAC-SHA256）、signature
* （sessionKey 对 signData 做 HMAC-SHA256），均在服务端生成。
*/
class WechatVirtualPayAdapter {
constructor() {
this.channel = 'wxvirtual';
}

async createOrder(order) {
// TODO(云联调): 在虚拟支付商户后台把会员档位配为"道具"（productId 与
// planId 对应，价格须与订单 amountFen 一致）；此处组装 signData
// {offerId, buyQuantity:1, env:0, currencyType:'CNY', productId,
// goodsPrice: amountFen, outTradeNo, attach} 并生成 paySig/signature。
throw notImplemented('wxvirtual.createOrder');
}

async requestPay(order) {
// TODO(云联调): 前端 wx.requestVirtualPayment({signData, paySig,
// signature, mode:'short_series_goods'})；iOS 需微信 >= 8.0.68 且已
// 配置小程序简称开通 Apple 支付。注意：前端 success 回调只表示
// "用户已付款动作完成"，发货一律以服务端发货推送为准（见 T0.3）。
throw notImplemented('wxvirtual.requestPay');
}

buildNotify(order, result) {
// 真实通道的回调由平台主动推送到服务端，不经前端组装；保留同名方法
// 只为接口形状一致，云联调时删除或改为从推送报文提取。
throw notImplemented('wxvirtual.buildNotify');
}

handleNotify(raw = {}) {
// TODO(云联调): raw 为平台发货推送 XML 解析后的对象，核心字段：
// Event='xpay_goods_deliver_notify'、OutTradeNo、WeChatPayInfo.MchOrderNo
// （平台单号 wx_order_id，幂等去重以它与 OutTradeNo 为准）、
// GoodsInfo.ProductId / Quantity / 价格字段（以联调时官方文档为准）。
// 本骨架只做字段名映射占位，金额字段名待联调核对后补齐。
return {
outTradeNo: raw.OutTradeNo,
amountFen: raw.amountFen, // TODO(云联调): 改为 GoodsInfo 的实付金额字段
paid: raw.Event === 'xpay_goods_deliver_notify',
};
}

async refund(order) {
// TODO(云联调): 安卓等终端在 MP 后台操作退款或
// 调 refund_order 接口；iOS 由用户向 App Store 申请、开发者无法主动
// 退款；退款完成都会收到 xpay_refund_notify 推送，再走 payment.refund。
throw notImplemented('wxvirtual.refund');
}
}

/** 按通道名取适配器：'mock'（默认）| 'wxvirtual' */
function createAdapter(channel = 'mock', opts = {}) {
if (channel === 'wxvirtual') return new WechatVirtualPayAdapter();
return new MockPayAdapter(opts);
}

module.exports = { MockPayAdapter, WechatVirtualPayAdapter, createAdapter};
