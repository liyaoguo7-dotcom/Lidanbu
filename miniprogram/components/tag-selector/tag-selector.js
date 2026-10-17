/**
 * 10 标签选择器（v3.1 13.4：收礼礼薄与送礼记录共用同一套；两排每排5个；单选；默认"结婚"）
 * 标签与图案从配置读取；图案为 icons/ 下 SVG。
 * 属性：selectedId 当前选中标签 id（为空则用配置默认）
 * 事件：change({ id, name }) 选择改变
 */
const AppConfig = require('../../config/app-config.js');

Component({
  properties: {
    selectedId: {
      type: String,
      value: '',
      observer(newVal) {
        if (newVal) this.setData({ currentId: newVal });
      },
    },
  },
  data: {
    tags: [],
    currentId: '',
  },
  lifetimes: {
    attached() {
      const tags = AppConfig.tags;
      const currentId = this.properties.selectedId || AppConfig.defaultTagId;
      this.setData({ tags, currentId });
    },
  },
  methods: {
    onSelect(e) {
      const id = e.currentTarget.dataset.id;
      const tag = this.data.tags.find((t) => t.id === id);
      this.setData({ currentId: id });
      this.triggerEvent('change', { id, name: tag ? tag.name : '' });
    },
  },
});
