/**
 * 礼单簿 · 电子请柬卡片视图组装（预览页/客人页/回执页共用）
 * 把 Invitation + 风格常量拼成模板可直接用的扁平字段；
 * 风格口径只来自 core/invitation-styles.js，不在页面写死颜色。
 */
const dataService = require('../../services/data-service.js');

function buildCard(inv) {
  if (!inv) return null;
  const style = dataService.getInvitationStyle(inv.styleId);
  const c = style.colors;
  let cardCss = `background:${c.paper};border:${style.borderCss};color:${c.ink};font-family:${style.fontStack}`;
  if (style.deco === 'arch') cardCss += ';border-radius:150px 150px 14px 14px';
  return {
    title: inv.title,
    typeName: dataService.invitationTypeName(inv.type),
    hostName: inv.hostName,
    dateText: inv.eventDate ? (inv.eventTime ? `${inv.eventDate} ${inv.eventTime}` : inv.eventDate) : '',
    address: inv.address || '',
    mapLocName: inv.mapLoc ? (inv.mapLoc.name || '') : '',
    blessing: inv.blessing || '',
    styleId: style.id,
    deco: style.deco,
    sealText: style.sealText,
    cardCss,
    pageCss: `background:${c.bg}`,
    primary: c.primary,
    accent: c.accent,
    sub: c.sub,
    line: c.line,
  };
}

module.exports = { buildCard };
