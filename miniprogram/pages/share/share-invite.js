/**
 * 礼单簿 · 发起邀请（2026-10-22 任务AB 第 7 项改版：取消「生成邀请」一步）
 * 流程：勾 5 开关（仅查看恒开不可取消）→ 选范围（至少一个收礼事件或"送礼"）
 *   → 页面主按钮从一开始就是 open-type="share" 的「邀请家人」，点一次直接
 *     拉起微信分享发给真实微信好友；对方点开分享卡片进入 share-view?code=邀请码
 *     即完成接受（邀请码 = membershipId，不绑定任何亲友，谁接受谁绑定）。
 * 邀请的创建/更新改为**静默预生成**：进入页面时、以及每次勾选变化后，后台
 *   自动创建（core share.invite）或更新（core share.updateGrant）同一份待发
 *   邀请，用户无感知、不多点一次。校验未通过（未选范围/非会员等）时不生成，
 *   按钮置灰并在下方给出原有提示文案。
 * 旧流程「先从亲友录 picker 选人」与「点生成邀请→再点分享」两步均已删除。
 */
const dataService = require('../../services/data-service.js');

Page({
  data: {
    switches: [],   // [{id,name,alwaysOn,on}]
    events: [],     // [{_id,name,checked}]
    giftsOn: false,
    inviteCode: '', // 预生成后 = membershipId；为空 = 暂不可发（按钮置灰）
    inviteHint: '', // 不可发时的提示文案（未选范围/生成失败原因）
  },

  _pendingId: '',   // 已预生成的待发邀请（membershipId），本页内只维护这一份
  _prepChain: null, // 预生成串行链：勾选连点时排队执行，避免并发建多份

  async onLoad() {
    await dataService.init();
    const summary = await dataService.exportSummary();
    const switches = dataService.getShareSwitches().map((s) => ({
      id: s.id, name: s.name, alwaysOn: !!s.alwaysOn, on: s.id === 'view' ? true : !!s.defaultOn,
    }));
    this.setData({
      switches,
      events: (summary.events || []).map((e) => ({ _id: e._id, name: e.name, checked: false })),
    });
    this._prepareInvite();
  },

  onSwitchToggle(e) {
    const id = e.currentTarget.dataset.id;
    const switches = this.data.switches.map((s) => {
      if (s.id !== id || s.alwaysOn) return s;
      return { ...s, on: !s.on };
    });
    this.setData({ switches });
    this._prepareInvite();
  },

  onEventToggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      events: this.data.events.map((ev) => (ev._id === id ? { ...ev, checked: !ev.checked } : ev)),
    });
    this._prepareInvite();
  },

  onGiftsToggle() {
    this.setData({ giftsOn: !this.data.giftsOn });
    this._prepareInvite();
  },

  _payload() {
    const switches = {};
    this.data.switches.forEach((s) => { switches[s.id] = s.on; });
    return {
      switches,
      scope: {
        events: this.data.events.filter((e) => e.checked).map((e) => e._id),
        gifts: this.data.giftsOn,
      },
    };
  },

  /** 静默预生成：串行执行；未选范围不生成、按钮置灰保留原文案提示 */
  _prepareInvite() {
    this._prepChain = (this._prepChain || Promise.resolve())
      .then(() => this._doPrepare())
      .catch(() => {});
    return this._prepChain;
  },

  async _doPrepare() {
    const payload = this._payload();
    if (payload.scope.events.length === 0 && !payload.scope.gifts) {
      this.setData({ inviteCode: '', inviteHint: '至少勾选一个收礼事件或"送礼"才能发出' });
      return;
    }
    try {
      if (!this._pendingId) {
        const r = await dataService.shareInvite(payload);
        this._pendingId = r.membershipId;
      } else {
        await dataService.updateGrant(this._pendingId, payload);
      }
      // 期间勾选可能又变了：以最新 payload 为准的结果才写回按钮状态
      this.setData({ inviteCode: this._pendingId, inviteHint: '' });
    } catch (e) {
      this.setData({ inviteCode: '', inviteHint: (e && e.message) || '邀请准备失败，请重试' });
    }
  },

  /** 分享给微信好友：path 带邀请码，落地页 share-view 凭码接受 */
  onShareAppMessage() {
    const code = this.data.inviteCode || '';
    return {
      title: '邀请你来共同记录人情往来——礼单簿家庭共享',
      path: code ? `/pages/share/share-view?code=${code}` : '/pages/share/share-home',
    };
  },
});
