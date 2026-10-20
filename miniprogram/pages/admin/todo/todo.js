/**
 * 老板平台 · 骨架页（阶段5 其余项）
 * ?key=account|photo|feedback|orders|screenshots|admins|abuse
 * 页面顶部明确标注"待后端接口"，结构完整但不编造数据：
 * 每页按将来真实形态给出分区（查询区/统计区/列表区/操作区），内容为空状态占位。
 * 铁律：绝不读取用户的礼金、联系人、备注内容，也不能替用户导出账本。
 * 因此本页任何分区都不设姓名、金额、备注类字段；账号一律用脱敏用户号。
 */
const PAGES = {
  account: {
    title: '账号查询',
    desc: '客服用：按脱敏用户号查询账号状态（条数级）。用户身份核验与查询接口待后端。',
    sections: [
      { title: '查询', hint: '输入脱敏用户号（如 abc***xyz）后查询', empty: '查询接口待后端，暂不能查询' },
      { title: '账号状态', hint: '将显示：注册时间、会员状态、各集合条数（不显示任何账本内容）', empty: '暂无查询结果' },
    ],
  },
  photo: {
    title: '拍照导入用量监控',
    desc: '各用户拍照导入次数/成功率统计（只看数量）。统计接口待后端。',
    sections: [
      { title: '用量概览', hint: '将显示：今日识别次数、成功率、失败次数（只看数量）', empty: '统计接口待后端，暂无数据' },
      { title: '按用户用量', hint: '将按脱敏用户号列出识别次数与失败次数', empty: '暂无数据' },
    ],
  },
  feedback: {
    title: '用户反馈列表',
    desc: '用户提交的反馈与处理状态。反馈接口待后端。',
    sections: [
      { title: '反馈列表', hint: '将按时间列出反馈与处理状态（待处理/已处理）', empty: '反馈接口待后端，暂无反馈' },
    ],
  },
  orders: {
    title: '会员订单与收入',
    desc: '会员订单、收入汇总（只看数字）。支付对账接口待后端。',
    sections: [
      { title: '收入汇总', hint: '将显示：今日/本月收入、订单数（只看数字）', empty: '支付对账接口待后端，暂无数据' },
      { title: '订单列表', hint: '将按时间列出订单号、档位、状态（不含账本内容）', empty: '暂无订单' },
    ],
  },
  screenshots: {
    title: '示例截图管理',
    desc: '上传替换空状态"点击查看示例"占位图。上传接口待后端。',
    sections: [
      { title: '收礼示例截图', hint: '当前为产品内占位图；接入后可在此上传替换', empty: '上传接口待后端，暂不能上传' },
      { title: '送礼示例截图', hint: '当前为产品内占位图；接入后可在此上传替换', empty: '上传接口待后端，暂不能上传' },
    ],
  },
  admins: {
    title: '管理员账号、权限与操作记录',
    desc: '管理员账号管理与全部操作记录。权限体系待后端。',
    sections: [
      { title: '管理员账号', hint: '将列出管理员账号与权限范围', empty: '权限体系待后端，暂无数据' },
      { title: '操作记录', hint: '配置修改等操作已在服务端写审计（action=config），本页接入后按时间列出', empty: '查询接口待后端，暂无数据' },
    ],
  },
  abuse: {
    title: '异常用户限制',
    desc: '异常账号的限制/解限操作，操作将记入操作记录。风控接口待后端。',
    sections: [
      { title: '限制操作', hint: '输入脱敏用户号后可限制/解除限制（操作记入操作记录）', empty: '风控接口待后端，暂不能操作' },
      { title: '已限制账号', hint: '将按脱敏用户号列出当前受限账号', empty: '暂无数据' },
    ],
  },
};

Page({
  data: { title: '', desc: '', sections: [] },
  onLoad(query) {
    const p = PAGES[(query && query.key)] || { title: '待开发', desc: '', sections: [] };
    wx.setNavigationBarTitle({ title: p.title });
    this.setData({ title: p.title, desc: p.desc, sections: p.sections });
  },
});
