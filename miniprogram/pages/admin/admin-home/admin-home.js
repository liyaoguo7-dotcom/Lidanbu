/**
 * 老板平台 · 首页（阶段5）
 * 铁律：只看统计数字和会员状态。任何页面都不得读取用户的礼金、
 * 联系人、备注内容，也不能替用户导出账本。
 */
Page({
  data: {
    // 分组口径（2026-10-25 用户定）：会员与钱相关的最靠前、能操作的在前，
    // 只看数据的靠后。target: 真页面 | config: 配置编辑页(section)
    groups: [
      { name: '会员与收入', items: [
        { no: '1', title: '会员管理', desc: '手动开通 / 延期', target: 'page', page: 'members' },
        { no: '2', title: '会员订单与收入', target: 'page', page: 'orders' },
        { no: '3', title: '额度与会员价格设置', target: 'config', section: 'pricing' },
        { no: '4', title: '会员与积分配置', desc: '注册赠送、拍照单价、积分礼包增删改', target: 'config', section: 'points' },
        { no: '5', title: '支付平台开关', desc: 'iPhone/安卓购买入口分别开关', target: 'config', section: 'platforms' },
        { no: '6', title: '会员专属功能清单设置', target: 'config', section: 'features' },
      ] },
      { name: '用户与安全', items: [
        { no: '7', title: '账号查询', desc: '客服用', target: 'page', page: 'account' },
        { no: '8', title: '异常用户限制', target: 'page', page: 'abuse' },
        { no: '9', title: '管理员账号、权限与操作记录', target: 'page', page: 'admins' },
      ] },
      { name: '运营设置', items: [
        { no: '10', title: '功能开关', target: 'config', section: 'switches' },
        { no: '11', title: '邀请奖励设置', desc: '开关、每邀请奖励数、成功邀请上限', target: 'config', section: 'invite' },
        { no: '12', title: '用户反馈列表', target: 'page', page: 'feedback' },
      ] },
      { name: '只看数据', items: [
        { no: '13', title: '数据概览', target: 'page', page: 'overview' },
        { no: '14', title: '用户额度使用情况', desc: '只看数量与剩余', target: 'page', page: 'quota-usage' },
        { no: '15', title: '拍照导入用量监控', target: 'page', page: 'photo-usage' },
        { no: '16', title: '邀请奖励数据', desc: '只看数量', target: 'page', page: 'invite' },
        { no: '17', title: '家庭共享概况', desc: '每人邀请了几位家人，只看数量', target: 'page', page: 'share-overview' },
        { no: '18', title: '示例截图管理', desc: '素材清单', target: 'page', page: 'screenshots' },
      ] },
    ],
  },
  onTapItem(e) {
    const it = e.currentTarget.dataset.item;
    if (it.target === 'page') {
      wx.navigateTo({ url: `/pages/admin/${it.page}/${it.page}` });
    } else if (it.target === 'config') {
      wx.navigateTo({ url: `/pages/admin/app-config/app-config?section=${it.section}` });
    } else {
      wx.navigateTo({ url: `/pages/admin/todo/todo?key=${it.key}` });
    }
  },
});
