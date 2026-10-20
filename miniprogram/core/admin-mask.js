/**
 * 礼单簿 · userId 脱敏（老板平台与邀请记录共用）
 * 前3 + *** + 后3，如 oAb***9zQ；短 id 只露前 2 位。
 */
function maskUserId(openid) {
  const s = String(openid || '');
  if (s.length <= 8) return s.slice(0, 2) + '***';
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

module.exports = { maskUserId };
