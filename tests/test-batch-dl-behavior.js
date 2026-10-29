/** DL批（用户 2026-10-30 定）：老板后台价格页紧凑排版——每档一张卡、行内并排小框，
 * 13 行压成 6 行；只改布局，字段、绑定、保存校验、二次确认、审计、添加／删除、
 * 推荐／上架、功能开关与积分规则页全不动。 */
const { test, assert } = require('./fw');
const fs = require('fs');
const path = require('path');
const readMp = (p) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', p), 'utf8');

test('DL 价格页：紧凑排版（卡片＋并排小框）且功能绑定全在', () => {
  const wxml = readMp('pages/admin/app-config/app-config.wxml');
  const js = readMp('pages/admin/app-config/app-config.js');
  const wxss = readMp('pages/admin/app-config/app-config.wxss');
  assert(wxml.includes('class="mini-row"') && wxml.includes('class="mini-field"') && wxml.includes('class="mini-label"') && wxml.includes('class="mini-input"'), '有并排小框结构');
  for (const f of ['name', 'yuan', 'androidYuan', 'iosYuan', 'days', 'grantPoints', 'qEvents', 'qPerEvent', 'qGifts', 'qContacts']) {
    assert(wxml.includes(`data-field="${f}"`), `档位字段绑定在：${f}`);
  }
  for (const f of ['recommended', 'onShelf']) {
    assert(wxml.includes(`data-field="${f}"`) && wxml.includes('bindchange="onPlanToggle"'), `开关绑定在：${f}`);
  }
  for (const k of ['receiveEvents', 'recordsPerEvent', 'giftRecords', 'contacts']) {
    assert(js.includes(`key: '${k}'`), `额度键在数据源里：${k}`);
  }
  assert(wxml.includes('data-key="{{item.key}}"'), '额度输入按数据源键绑定');
  assert(wxml.includes('data-group="freeQuota"') && wxml.includes('data-group="memberQuota"'), '免费／会员额度分组绑定在');
  assert(wxml.includes('bindtap="onDelPlan"') && wxml.includes('bindtap="onAddPlan"') && wxml.includes('bindtap="onSavePricing"'), '删除／添加／保存按钮在');
  assert(wxml.includes('上架关掉即一键下架，购买页不显示'), '上架提示文案在（改行不改字）');
  assert(wxml.includes('买套餐的会员按下面各自档位卡片里的额度走'), '额度兜底说明在');
  assert(js.includes('onPlanInput') && js.includes('onPlanToggle') && js.includes('onQuotaInput') && js.includes('onSavePricing'), '处理与保存逻辑不动');
  assert(js.includes('adminUpdatePricing') && js.includes('adminUpdateQuotaSettings'), '保存仍走额度＋价格两接口');
  assert(wxss.includes('.plan { background: #F8F8F8;') && wxss.includes('.mini-row { display: flex;'), '档位卡片与并排样式在');
  assert(wxss.includes('.mini-input {') && wxss.includes('font-size: 16px;'), '小框字号与后台主文字一致（16px）');
});
