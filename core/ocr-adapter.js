/**
 * 礼单簿 · OCR 适配层（阶段4 拍照导入）
 *
 * 页面只依赖本接口，不依赖具体厂商：
 *   recognize(imagePath, opts) -> Promise<[{ name, amountFen?, note?, raw }]>
 * - imagePath：本地图片路径（wx.chooseImage 的 tempFilePath）
 * - opts.kind：'gift'（送礼）| 'receive'（收礼）
 * - opts.provider：'mock'（默认）| 'tencent' | 'ali' | 'wechat'
 * - 返回：识别出的条目数组；name 为识别到的姓名原文，amountFen 为整数分
 *   （识别不到金额时可缺省，页面上由用户补填），raw 为该条原始识别文本。
 *
 * 本轮只实现 MockOCR（假识别结果，可编辑）；真实厂商后接。
 * 纯 JS，无微信依赖，可进小程序包。
 */

const PROVIDERS = ['mock', 'tencent', 'ali', 'wechat'];

/**
 * MockOCR：模拟"打印体纸质礼单"的识别结果（假数据，可编辑）。
 * 确定性返回，便于测试与演示；页面上每条都可改、可删、可补录。
 */
const MockOCR = {
  name: 'mock',
  async recognize(imagePath, opts = {}) {
    if (!imagePath) throw new Error('请先拍照');
    // 可控失败态（演示/测试用）：opts.fail=true 或图片路径含 mockfail 时模拟识别失败
    if (opts.fail === true || String(imagePath).includes('mockfail')) {
      throw new Error('这张照片没认出来');
    }
    const kind = opts.kind === 'receive' ? 'receive' : 'gift';
    if (kind === 'receive') {
      return [
        { name: '张三', amountFen: 100000, note: '', raw: '张三 1000' },
        { name: '赵六', amountFen: 80000, note: '', raw: '赵六 800' },
      ];
    }
    return [
      { name: '张三', amountFen: 100000, note: '', raw: '张三 1000' },
      { name: '李五', amountFen: 50000, note: '同学', raw: '李五 500 同学' },
      { name: '王二麻', amountFen: 200000, note: '', raw: '王二麻 2000' },
    ];
  },
};

/**
 * 腾讯云 OCR（骨架，后接）。
 * 后接时填：在云函数里用 secretId/secretKey 调"通用印刷体识别"；
 * 图片转 base64 传给云函数；密钥放云函数环境变量，绝不进小程序包；
 * 返回按 [{ name, amountFen, note, raw }] 组装（金额"xxx元"→分）。
 */
const TencentOCR = {
  name: 'tencent',
  async recognize() {
    throw new Error('OCR 厂商未接入：待用户拍板后由云函数实现');
  },
};

/**
 * 阿里云 OCR（骨架，后接）。
 * 后接时填：云函数里按 API 单独开通"通用文字识别"；
 * 密钥放云函数环境变量，绝不进小程序包；返回组装同上。
 */
const AliOCR = {
  name: 'ali',
  async recognize() {
    throw new Error('OCR 厂商未接入：待用户拍板后由云函数实现');
  },
};

/**
 * 微信小程序 OCR（骨架，后接）。
 * 后接时填：云开发 AI 能力（若有通用印刷体/手写体接口）；
 * 无密钥接入，云调用；返回组装同上。
 */
const WeChatOCR = {
  name: 'wechat',
  async recognize() {
    throw new Error('OCR 厂商未接入：待用户拍板后由云函数实现');
  },
};

const _adapters = { mock: MockOCR, tencent: TencentOCR, ali: AliOCR, wechat: WeChatOCR };

/**
 * 统一识别入口（页面只调这个）。
 */
async function recognize(imagePath, opts = {}) {
  const provider = opts.provider || 'mock';
  const adapter = _adapters[provider];
  if (!adapter) throw new Error(`未知的 OCR 厂商：${provider}`);
  const list = await adapter.recognize(imagePath, opts);
  if (!Array.isArray(list)) throw new Error('OCR 返回格式异常');
  return list.map((it) => ({
    name: String(it.name || '').trim(),
    amountFen: Number.isInteger(it.amountFen) && it.amountFen > 0 ? it.amountFen : null,
    note: String(it.note || ''),
    raw: String(it.raw || ''),
  }));
}

module.exports = { recognize, PROVIDERS, MockOCR, TencentOCR, AliOCR, WeChatOCR };
