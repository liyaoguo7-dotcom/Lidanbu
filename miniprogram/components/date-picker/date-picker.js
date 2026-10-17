/**
 * 日期选择（v3.1：默认当天，可改，日历或滚轮选择，不手写）
 * 属性：value 当前日期 YYYY-MM-DD（为空则默认当天）
 * 事件：change({ value }) 日期改变
 */
Component({
  properties: {
    value: { type: String, value: '' },
  },
  data: {
    displayValue: '',
  },
  lifetimes: {
    attached() {
      const v = this.properties.value || this.today();
      this.setData({ displayValue: v });
    },
  },
  methods: {
    today() {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    },
    onChange(e) {
      const v = e.detail.value;
      this.setData({ displayValue: v });
      this.triggerEvent('change', { value: v });
    },
  },
});
