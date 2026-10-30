/**
 * 礼单簿 · 拍照导入：攒照片页（BJ批，用户 2026-10-27 定）
 * 相册多选或连拍多张，先攒在本页，点了「开始识别」才逐张识别。
 * 按张计费：一张照片一个识别任务、一个任务扣一次分（识别成功扣分，
 * 失败不扣；识别成功后不导入不退）——单价读服务端积分规则（老板后台
 * 可配，BN批），页内计费说明按生效单价动态生成；点「开始识别」直接
 * 开始、不再弹确认窗（BN批，用户定：说明只留页面这一处）。
 * 识别成功的逐张排队进核对页；失败/未识别的照片留在本页可重试。
 */
const dataService = require('../../services/data-service.js');
const { saveImport, setImportQueue } = require('../../services/import-state.js');

const MAX_PHOTOS = 9;

Page({
  data: {
    kind: 'gift',
    kindLabel: '送礼',
    eventId: '',
    eventName: '',
    photos: [], // 本地临时路径数组（还没识别的）
    working: false,
    progressText: '',
    maxPhotos: MAX_PHOTOS,
    photoCost: 2, // 拍照单价（分）：先按已定价渲染，进页后读生效配置刷新（BN批）
  },

  onLoad(q) {
    const kind = q && q.kind === 'receive' ? 'receive' : 'gift';
    /* BN批：礼薄名经 navigateTo 传参是 URL 编码过的，进页必须解码——
     * 否则标题与核对页原图对照都显示 %E5%A5… 乱码（真机实证）。
     * 无 % 的原样字符串解码无副作用；解码异常保持原值。 */
    let eventName = (q && q.eventName) || '';
    try { eventName = decodeURIComponent(eventName); } catch (e) { /* 保持原值 */ }
    this.setData({
      kind,
      kindLabel: kind === 'receive' ? '收礼' : '送礼',
      eventId: (q && q.eventId) || '',
      eventName,
    });
    dataService.getPointsSettings()
      .then((s) => {
        if (s && typeof s.photoImportCost === 'number') this.setData({ photoCost: s.photoImportCost });
      })
      .catch(() => {});
  },

  onAddPhotos() {
    const left = MAX_PHOTOS - this.data.photos.length;
    if (left <= 0) {
      wx.showToast({ title: `一次最多攒 ${MAX_PHOTOS} 张`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const add = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
        if (add.length) this.setData({ photos: this.data.photos.concat(add).slice(0, MAX_PHOTOS) });
      },
    });
  },

  onRemovePhoto(e) {
    const i = Number(e.currentTarget.dataset.i);
    const photos = this.data.photos.slice();
    photos.splice(i, 1);
    this.setData({ photos });
  },

  onPreview(e) {
    const i = Number(e.currentTarget.dataset.i);
    wx.previewImage({ urls: this.data.photos, current: this.data.photos[i] });
  },

  async onStartRecognize() {
    if (this.data.working) return;
    const photos = this.data.photos.slice();
    if (!photos.length) {
      wx.showToast({ title: '先添加照片', icon: 'none' });
      return;
    }
    const { kind, eventId, eventName } = this.data;
    /* BN批（用户定）：点「开始识别」直接开始，不再弹确认窗 */
    this.setData({ working: true });
    const doneJobs = [];
    const failedIdx = [];
    let stopReason = '';
    for (let i = 0; i < photos.length; i++) {
      this.setData({ progressText: `正在识别第 ${i + 1} / ${photos.length} 张…` });
      try {
        const r = await dataService.recognizePhoto(photos[i], kind, { eventId });
        doneJobs.push({
          kind, eventId, eventName,
          photoPath: photos[i],
          photoFileIds: r.photoFileIds || [],
          items: r.items,
          jobId: r.jobId,
        });
      } catch (e) {
        failedIdx.push(i);
        if (e && e.code === 'insufficient-points') { stopReason = 'points'; break; }
        if (e && e.code === 'member-required') { stopReason = 'member'; break; }
      }
    }
    this.setData({ working: false, progressText: '' });
    // 识别成功的从本页移除（已进核对队列）；失败/未识别的留在本页可重试
    const donePaths = new Set(doneJobs.map((j) => j.photoPath));
    this.setData({ photos: this.data.photos.filter((p) => !donePaths.has(p)) });
    if (!doneJobs.length) {
      wx.showModal({
        title: stopReason === 'points' ? '积分不够啦' : '没认出来',
        content: stopReason === 'points'
          ? '积分不足，这次没有识别，也没有扣费。先去补充一点积分再来。'
          : '这批照片都没认出来，均不收费。把礼单放平、光线亮一点，调整后点「开始识别」重试。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    if (failedIdx.length > 0) {
      await new Promise((resolve) => {
        wx.showModal({
          title: '识别完成',
          content: stopReason === 'points'
            ? `已识别 ${doneJobs.length} 张；积分不足，剩下的没识别（未扣费），补充积分后可继续。先核对已识别的。`
            : `成功 ${doneJobs.length} 张，没认出来 ${failedIdx.length} 张（没认出来的不扣费，照片还留在这页可重试）。先核对成功的。`,
          showCancel: false,
          confirmText: '去核对',
          success: () => resolve(),
          fail: () => resolve(),
        });
      });
    }
    saveImport(doneJobs[0]);
    setImportQueue(doneJobs.slice(1));
    wx.navigateTo({ url: '/pages/import/import-review' });
  },
});
