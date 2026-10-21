/**
 * 礼单簿 · 内容安全适配层（任务Q1）
 *
 * 接口契约：{ checkText(text) -> Promise<{ pass:boolean, label?:string }> }
 * pass=false 表示文本不合规。调用方（core/users.updateProfile）对适配层
 * 异常的口径是：**放行并记审计**，不因检测服务故障堵死用户改昵称；
 * 本文件只负责"怎么检测"，不负责异常口径。
 *
 * 两种实现：
 * - LocalBlocklistSafety（现行默认）：本地词表命中即不通过。
 *   词表在配置 AppConfig.contentSafety.localBlocklist（默认空数组），
 *   只是占位兜底——本地词表查不全，上线前应切到微信官方检测。
 * - WechatMsgSecCheck（骨架）：微信内容安全接口 security.msgSecCheck。
 *   该接口只能在服务端/云函数里调用（需要 access_token），云联调后
 *   在云函数侧实现并经云调用接入；当前调用直接抛
 *   'content-safety-not-implemented'，由调用方按异常口径处理，
 *   绝不假装已接入、更不返回假通过结论冒充检测结果。
 */

function createLocalSafety(config) {
  const list = (config && config.contentSafety && config.contentSafety.localBlocklist) || [];
  return {
    name: 'local-blocklist',
    async checkText(text) {
      const s = String(text == null ? '' : text);
      const hit = list.find((w) => w && s.includes(String(w)));
      return { pass: !hit, label: hit ? 'local-blocklist' : '' };
    },
  };
}

const wechatMsgSecCheck = {
  name: 'wechat-msgSecCheck',
  async checkText() {
    // 云联调 TODO：在云函数中用 wx-server-sdk 的 security.msgSecCheck
    // 校验文本（scene 按调用场景传），把 risky/suggest 结果归一化为
    // {pass} 后从这里返回。在此之前抛错走调用方的放行+审计口径。
    const e = new Error('微信内容安全接口（msgSecCheck）尚未接入，云联调后启用');
    e.code = 'content-safety-not-implemented';
    throw e;
  },
};

/** 按配置选适配层：contentSafety.provider='wechat' → 微信骨架，其余 → 本地词表 */
function resolveAdapter(config) {
  if (config && config.contentSafety && config.contentSafety.provider === 'wechat') {
    return wechatMsgSecCheck;
  }
  return createLocalSafety(config);
}

module.exports = { createLocalSafety, wechatMsgSecCheck, resolveAdapter };
