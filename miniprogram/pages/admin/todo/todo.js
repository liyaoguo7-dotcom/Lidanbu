/**
 * 老板平台 · 骨架页（阶段5 其余项）
 * ?key=account|photo|feedback|orders|screenshots|admins|abuse
 * 页面顶部明确标注"待后端接口"，不编造数据。
 * 铁律：绝不读取用户的礼金、联系人、备注内容，也不能替用户导出账本。
 */
const PAGES = {
  account: { title: '账号查询', desc: '客服用：按脱敏用户号查询账号状态（条数级）。用户身份核验与查询接口待后端。' },
  photo: { title: '拍照导入用量监控', desc: '各用户拍照导入次数/成功率统计（只看数量）。统计接口待后端。' },
  feedback: { title: '用户反馈列表', desc: '用户提交的反馈与处理状态。反馈接口待后端。' },
  orders: { title: '会员订单与收入', desc: '会员订单、收入汇总（只看数字）。支付对账接口待后端。' },
  screenshots: { title: '示例截图管理', desc: '上传替换空状态"点击查看示例"占位图。上传接口待后端。' },
  admins: { title: '管理员账号、权限与操作记录', desc: '管理员账号管理与全部操作记录。权限体系待后端。' },
  abuse: { title: '异常用户限制', desc: '异常账号的限制/解限操作，操作将记入操作记录。风控接口待后端。' },
};

Page({
  data: { title: '', desc: '' },
  onLoad(query) {
    const p = PAGES[(query && query.key)] || { title: '待开发', desc: '' };
    wx.setNavigationBarTitle({ title: p.title });
    this.setData({ title: p.title, desc: p.desc });
  },
});
