/**
 * 礼单簿 · 金额显示唯一入口（检查点1修改意见第4条，高风险：金额）
 *
 * 铁律：全产品任何位置显示金额，必须调 formatAmount 或 formatAmountInt，
 * 页面里不许自己拼（不许再出现 amount/100、toFixed、toLocaleString 拼金额）。
 * 金额在数据库里永远以"分"（整数）存储，大写/显示只是表现层。
 *
 * 显示规则（用户 2026-10-18 拍板，2026-10-20 修订）：
 * - 两位小数（formatAmount）：送礼列表、收礼记录列表、往来竖线树（条目+汇总）、
 *   送礼详情、收礼详情；以及所有金额输入框的回填（编辑态）。
 * - 整数场景（formatAmountInt）：其他一切金额显示（往来页总额/差额/亲友行、共计行、
 *   导出概览、会员额度页、共享总额等）。整元时显示整数，带零头时显示两位小数，
 *   绝不四舍五入（用户 2026-10-20 拍板，覆盖此前"四舍五入到元"的口径）。
 * - Excel 导出（core/export-xlsx.js）不受此规则影响，仍为数值单元格 0.00 格式。
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
 * 分 → 整数场景金额字符串（整元去尾、带分保留两位，绝不四舍五入）
 * 显示规则（用户 2026-10-18 拍板，2026-10-20 修订）：除"两位小数"清单内的位置外，
 * 其他一切金额显示一律用本函数；整元显示整数，带零头显示两位小数。
 * @param {number} fen 整数分，可为负（符号由调用方按规则加）
 * @returns {string} 如 886600 → "8866"；1250 → "12.50"；100005 → "1000.05"；
 * 100050 → "1000.50"；0 → "0"；-1250 → "-12.50"
 * 非有限数字一律返回 "0"（显示层永不抛错）。
 */
function formatAmountInt(fen) {
  const s = formatAmount(fen);
  // formatAmount 非法输入返回 "0.00"，走同一条去尾路径得到 "0"，符合本函数口径
  return s.endsWith('.00') ? s.slice(0, -3) : s;
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

/**
 * 分 → 财务大写中文金额（横置红字礼单本用，阶段4）
 * @param {number} fen 整数分（应为非负；负数前加"负"字；非数字按 0 处理）
 * @returns {string} 如 100000 → "壹仟元整"；100055 → "壹仟元伍角伍分"
 * 规范：零→"零元整"；10元→"壹拾元整"；101→"壹佰零壹元整"；
 * 1050→"壹仟零伍拾元整"；10000→"壹万元整"；100000→"壹拾万元整"；
 * 110000→"壹拾壹万元整"；1000000→"壹佰万元整"；
 * 有角无分→"…角"；无角有分→"…零…分"；有角有分→"…角…分"；无角分→"…元整"。
 */
const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_RADICES = ['仟', '佰', '拾', '']; // 四位一组内的位权（千→个）
const CN_BIG = ['', '万', '亿'];

/** 四位一组（0-9999）→ 中文，不带大单位 */
function sectionToChinese(section) {
  const ds = [
    Math.floor(section / 1000),
    Math.floor(section / 100) % 10,
    Math.floor(section / 10) % 10,
    section % 10,
  ];
  let s = '';
  let zeroPending = false;
  for (let i = 0; i < 4; i++) {
    const d = ds[i];
    if (d !== 0) {
      if (zeroPending) { s += '零'; zeroPending = false; }
      s += CN_DIGITS[d] + CN_RADICES[i];
    } else if (s !== '') {
      zeroPending = true; // 组内高位已有非零，记一个待定的零
    }
  }
  return s;
}

/** 非负整数元 → 中文（不带"元"字） */
function intYuanToChinese(n) {
  if (n === 0) return '零';
  const secs = [];
  let rest = n;
  while (rest > 0) { secs.push(rest % 10000); rest = Math.floor(rest / 10000); }
  let result = '';
  let needZero = false; // 跳过了全零组，低位再出现非零组时补"零"
  for (let i = secs.length - 1; i >= 0; i--) {
    const secStr = sectionToChinese(secs[i]);
    if (secStr === '') {
      if (result !== '') needZero = true;
      continue;
    }
    if (needZero) {
      result += '零';
      needZero = false;
    } else if (result !== '' && secs[i] < 1000) {
      result += '零'; // 低位组不满四位（如"壹万"后跟"壹"→"壹万零壹"）
    }
    result += secStr + CN_BIG[i];
  }
  return result;
}

function amountToChineseUpper(fen) {
  let n = Number(fen);
  if (!Number.isFinite(n)) n = 0;
  n = Math.round(n);
  const neg = n < 0 ? '负' : '';
  const abs = Math.abs(n);
  const yuan = Math.floor(abs / 100);
  const jiao = Math.floor((abs % 100) / 10);
  const cent = abs % 10;
  let s = neg + intYuanToChinese(yuan) + '元';
  if (jiao === 0 && cent === 0) {
    s += '整';
  } else {
    if (jiao > 0) s += CN_DIGITS[jiao] + '角';
    else if (cent > 0) s += '零';
    if (cent > 0) s += CN_DIGITS[cent] + '分';
  }
  return s;
}

module.exports = { formatAmount, formatAmountInt, parseAmountToFen, amountToChineseUpper };
