/**
 * 礼单簿 · 金额显示唯一入口（检查点1修改意见第4条，高风险：金额）
 *
 * 铁律：全产品任何位置显示金额，必须调 formatAmount，页面里不许自己拼
 * （不许再出现 amount/100、toFixed、toLocaleString 拼金额）。
 * 金额在数据库里永远以"分"（整数）存储，大写/显示只是表现层。
 */

/**
 * 分 → 两位小数金额字符串
 * @param {number} fen 整数分，可为负（送出金额由调用方加负号或直接传负数）
 * @returns {string} 如 100000 → "1000.00"；-100000 → "-1000.00"；0 → "0.00"
 * 非有限数字一律返回 "0.00"（显示层永不抛错）；小数分先四舍五入到整分。
 */
function formatAmount(fen) {
  const n = Number(fen);
  if (!Number.isFinite(n)) return '0.00';
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${yuan}.${String(cents).padStart(2, '0')}`;
}

/**
 * 用户输入的金额字符串 → 整数分；非法返回 null
 * 规则：去空格；只允许数字、最多一位小数点、最多两位小数；必须 > 0
 * @param {string} str 如 "1000" / "1000.5" / "1000.05"
 * @returns {number|null} 整数分，如 "1000" → 100000；非法 → null
 */
function parseAmountToFen(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const fen = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(fen) || fen <= 0) return null;
  return fen;
}

module.exports = { formatAmount, parseAmountToFen };
