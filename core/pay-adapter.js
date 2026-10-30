/**
* 礼单簿 · 支付适配层（任务K）
*
* 统一接口（页面与业务层只认这组方法，不感知具体通道）：
* createOrder(order) 在支付通道侧建单，返回 {channelTradeNo}（真实通道
* 返回 {payParams}，见 WechatVirtualPayAdapter）
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
* - WechatVirtualPayAdapter：微信虚拟支付（道具直购，2026-10-30 接入）。
* 依据 docs/T0.3 结论：会员收费属虚拟商品，必须走官方
* 小程序虚拟支付"道具直购"（wx.requestVirtualPayment），发货以平台
* 发货推送（xpay_goods_deliver_notify）为准、query_order 查单兜底，
* 前端支付回调不作为发货依据。
* ★个人主体虚拟支付新政（2026-10-20 官方文档《虚拟支付：个人》核实）：
* 个人主体 + 服务类目含「工具」+ 完成认证、备案即可开通，月支付限额
* 10 万元，费率安卓 1%（腾讯技术服务费）/ iOS 12%（Apple 佣金），
* 结算安卓 T+3、iOS 约 45–60 天。个人与企业/个体户两种主体共用本
* 适配接口，切换主体只换配置（OfferID/AppKey/道具 ID），业务代码不动。
* ★密钥铁律：AppKey 与 AppSecret 只从云函数环境变量读（VIRTUAL_PAY_APP_KEY /
* WECHAT_APP_SECRET），绝不进前端代码、绝不进聊天、绝不写死在本文件；
* 缺失时抛带码错误，由操作人自行填进云函数环境变量。
* ★真实通道流程（与 Mock 的服务端调起不同）：
* 服务端 createOrder 只建单签名，返回 payParams；前端拿 payParams 调
* wx.requestVirtualPayment；发货只认平台发货推送（payment.processNotify）。
* 因此本适配器的 requestPay / buildNotify 故意抛错，防旧编排误调。
*/
const crypto = require('crypto');
const https = require('https');
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

/* ================= 微信虚拟支付（真实通道） ================= */

/** OfferID（公开标识，可放前端）；AppID（公开标识，code2Session 用） */
const VIRTUAL_OFFER_ID = '14507000890';
const VIRTUAL_APP_ID = 'wx34795db0377195ca';

/**
* 道具 ID 表：档位/礼包 id → {android, ios}，与微信后台已发布的 14 个
* 道具一一对应（2026-10-30 全部已发布）。服务端下单时按终端平台取 ID，
* 取不到即拒单（道具与渠道一致校验），绝不拿错平台的道具成交。
*/
const VIRTUAL_PRODUCT_IDS = {
month: { android: 'month_android', ios: 'month_ios' },
halfYear: { android: 'halfYear_android', ios: 'halfYear_ios' },
year: { android: 'year_android', ios: 'year_ios' },
fiveYear: { android: 'fiveYear_android', ios: 'fiveYear_ios' },
points10: { android: 'points10_android', ios: 'points10_ios' },
points30: { android: 'points30_android', ios: 'points30_ios' },
points50: { android: 'points50_android', ios: 'points50_ios' },
};

/** 平台归一化：只认 ios / android，其余一律返回空串（调用方据此拒单） */
function normalizePlatform(platform) {
const p = String(platform || '').toLowerCase();
return (p === 'ios' || p === 'android') ? p : '';
}

/** 按档位/礼包 id 与平台取道具 ID；取不到返回 null（调用方拒单） */
function resolveProductId(itemId, platform) {
const p = normalizePlatform(platform);
if (!p) return null;
const entry = VIRTUAL_PRODUCT_IDS[itemId];
return entry ? entry[p] : null;
}

/**
* 分平台价：对应平台价为整数时用它，否则跟现价 priceFen
* （与 DJ 批同口径：留空则跟现价，购买仍走 priceFen 兜底）。
*/
function platformPriceFen(item, platform) {
const p = normalizePlatform(platform);
if (p === 'ios' && Number.isInteger(item.iosPriceFen)) return item.iosPriceFen;
if (p === 'android' && Number.isInteger(item.androidPriceFen)) return item.androidPriceFen;
return item.priceFen;
}

function hmacSha256Hex(key, msg) {
return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');
}

/** signData 对象（字段顺序固定，便于签名复现与测试） */
function buildSignData({ productId, amountFen, outTradeNo, attach, offerId }) {
return {
offerId: offerId || VIRTUAL_OFFER_ID,
buyQuantity: 1,
env: 0,
currencyType: 'CNY',
productId,
goodsPrice: amountFen,
outTradeNo,
attach: attach || '',
};
}

/**
* 生成前端调起支付所需的签名三件套（均在服务端生成）：
* - signData：JSON 字符串（原样传给 wx.requestVirtualPayment）
* - paySig：AppKey 对 "requestVirtualPayment&signData" 做 HMAC-SHA256
* - signature：sessionKey 对 signData 做 HMAC-SHA256
*/
function signPayParams({ appKey, sessionKey, signData }) {
const signDataStr = typeof signData === 'string' ? signData : JSON.stringify(signData);
return {
signData: signDataStr,
paySig: hmacSha256Hex(appKey, `requestVirtualPayment&${signDataStr}`),
signature: hmacSha256Hex(sessionKey, signDataStr),
mode: 'short_series_goods',
};
}

/** 默认 code2Session 请求（https GET + JSON 解析；测试可注入 httpGetJson 替换） */
function defaultHttpGetJson(url) {
return new Promise((resolve, reject) => {
https.get(url, (res) => {
let data = '';
res.on('data', (chunk) => { data += chunk; });
res.on('end', () => {
try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
});
}).on('error', reject);
});
}

/** 从平台发货/退款推送报文里取平台单号（幂等去重的另一半键） */
function pickPlatformOrderNo(raw = {}) {
if (!raw || typeof raw !== 'object') return null;
if (raw.WeChatPayInfo && raw.WeChatPayInfo.MchOrderNo) return raw.WeChatPayInfo.MchOrderNo;
return raw.MchOrderNo || raw.wxOrderId || raw.platformOrderNo || null;
}

/**
* 微信虚拟支付适配器（真实通道）。
* 构造 opts（全部可选，生产一律走环境变量）：
* - offerId：默认 VIRTUAL_OFFER_ID
* - appKey / appSecret：显式注入（仅测试用）；生产从环境变量读
* - env：环境变量对象（默认 process.env；测试可注入假 env）
* - httpGetJson：code2Session 请求函数（默认 https；测试可注入假实现）
* - sessionKey：本适配器不保存 sessionKey（每次下单由调用方经 opts 传入，
*   或由 loginCode 实时换取，避免服务端长期存用户登录态）。
*/
class WechatVirtualPayAdapter {
constructor(opts = {}) {
this.channel = 'wxvirtual';
this.offerId = opts.offerId || VIRTUAL_OFFER_ID;
this.appKey = opts.appKey;
this.appSecret = opts.appSecret;
this.env = opts.env || process.env;
this.httpGetJson = opts.httpGetJson || defaultHttpGetJson;
}

getAppKey() {
const k = String(this.appKey || (this.env && this.env.VIRTUAL_PAY_APP_KEY) || '').trim();
if (!k) {
const e = new Error(errors.userMessage('pay-appkey-missing'));
e.code = 'pay-appkey-missing';
e.detail = 'VIRTUAL_PAY_APP_KEY 缺失：请在云函数环境变量中配置虚拟支付 AppKey（切勿写进代码或发给任何人）';
throw e;
}
return k;
}

getAppSecret() {
const k = String(this.appSecret || (this.env && this.env.WECHAT_APP_SECRET) || '').trim();
if (!k) {
const e = new Error(errors.userMessage('pay-appsecret-missing'));
e.code = 'pay-appsecret-missing';
e.detail = 'WECHAT_APP_SECRET 缺失：请在云函数环境变量中配置小程序 AppSecret（切勿写进代码或发给任何人）';
throw e;
}
return k;
}

/** code2Session：前端 wx.login 拿到的 code 换 session_key（供 signature 用） */
async exchangeCodeForSessionKey(loginCode) {
const secret = this.getAppSecret();
const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${VIRTUAL_APP_ID}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(loginCode)}&grant_type=authorization_code`;
const r = await this.httpGetJson(url);
if (!r || !r.session_key) {
const e = new Error(errors.userMessage('pay-session-missing'));
e.code = 'pay-session-missing';
e.detail = `code2Session 失败：${r && (r.errmsg || r.errcode)}`;
throw e;
}
return r.session_key;
}

/**
* 建单签名（服务端唯一职责）：按平台取道具 ID、组装 signData、生成
* paySig/signature，返回 payParams 给前端调 wx.requestVirtualPayment。
* @param {object} order 业务订单（含 outTradeNo / amountFen / planId / kind）
* @param {{platform:string, sessionKey?:string, loginCode?:string}} opts
*   platform 必传（ios/android）；sessionKey 与 loginCode 二选一
*   （loginCode 由前端 wx.login 实时提供，服务端换取 session_key）。
*/
async createOrder(order, opts = {}) {
const platform = normalizePlatform(opts.platform);
if (!platform) {
const e = new Error(errors.userMessage('pay-platform-required'));
e.code = 'pay-platform-required';
throw e;
}
const productId = resolveProductId(order.planId, platform);
if (!productId) {
const e = new Error(errors.userMessage('pay-product-missing'));
e.code = 'pay-product-missing';
e.detail = `无对应道具：planId=${order.planId} platform=${platform}`;
throw e;
}
const appKey = this.getAppKey();
const sessionKey = opts.sessionKey
|| (opts.loginCode ? await this.exchangeCodeForSessionKey(opts.loginCode) : null);
if (!sessionKey) {
const e = new Error(errors.userMessage('pay-session-missing'));
e.code = 'pay-session-missing';
throw e;
}
const signData = buildSignData({
productId,
amountFen: order.amountFen,
outTradeNo: order.outTradeNo,
attach: `${order.kind || 'plan'}:${order.planId}`,
offerId: this.offerId,
});
const payParams = signPayParams({ appKey, sessionKey, signData });
return { channel: this.channel, productId, payParams };
}

/**
* 真实通道不走服务端调起：前端拿 createOrder 返回的 payParams 调
* wx.requestVirtualPayment；iOS 需微信 >= 8.0.68 且已配置小程序简称开通
* Apple 支付。前端 success 回调只表示"用户已付款动作完成"，发货一律
* 以服务端发货推送为准（见 payment.processNotify）。
*/
async requestPay() {
throw notImplemented('wxvirtual.requestPay（请在前端用 createOrder 返回的 payParams 调 wx.requestVirtualPayment）');
}

/** 真实通道的回调由平台主动推送到服务端，不经前端组装 */
buildNotify() {
throw notImplemented('wxvirtual.buildNotify（真实回调由平台发货推送到服务端，不经前端组装）');
}

/**
* 归一化平台推送（发货推送 XML 解析后的对象；字段名以联调时官方文档为准）：
* - 发货：Event='xpay_goods_deliver_notify' → paid=true
* - 退款：Event='xpay_refund_notify' → refund=true（只记账，不自动改状态，
*   回收仍走 payment.refund 人工通道；验签接线后可升级为自动回收）
* - 金额：推送报文不带可信金额字段时 amountFen 为空，payment.handleNotify
*   凭平台单号（platformOrderNo）放行（金额已在下单签名时由平台验过），
*   无平台单号又无金额的报文一律拒绝。
*/
handleNotify(raw = {}) {
const event = raw.Event || raw.event;
const platformOrderNo = pickPlatformOrderNo(raw);
if (event === 'xpay_refund_notify') {
return {
outTradeNo: raw.OutTradeNo || raw.outTradeNo,
amountFen: Number.isInteger(raw.amountFen) ? raw.amountFen : undefined,
paid: false,
refund: true,
platformOrderNo,
};
}
return {
outTradeNo: raw.OutTradeNo || raw.outTradeNo,
amountFen: Number.isInteger(raw.amountFen) ? raw.amountFen : undefined,
paid: event === 'xpay_goods_deliver_notify',
platformOrderNo,
};
}

/**
* 真实退款不走本适配器自动执行：安卓在 MP 后台操作退款或调
* refund_order 接口；iOS 由用户向 App Store 申请、开发者无法主动退款；
* 退款完成都会收到 xpay_refund_notify 推送，再走 payment.refund 回收。
*/
async refund() {
throw notImplemented('wxvirtual.refund（安卓请在 MP 后台或调 refund_order 接口退款；iOS 由用户向 App Store 申请；退款完成后平台推送 xpay_refund_notify）');
}
}

/** 按通道名取适配器：'mock'（默认）| 'wxvirtual' */
function createAdapter(channel = 'mock', opts = {}) {
if (channel === 'wxvirtual') return new WechatVirtualPayAdapter(opts);
return new MockPayAdapter(opts);
}

module.exports = {
MockPayAdapter,
WechatVirtualPayAdapter,
createAdapter,
VIRTUAL_OFFER_ID,
VIRTUAL_APP_ID,
VIRTUAL_PRODUCT_IDS,
normalizePlatform,
resolveProductId,
platformPriceFen,
buildSignData,
signPayParams,
};
