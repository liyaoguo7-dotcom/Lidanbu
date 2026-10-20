/**
 * 礼单簿 · 横置礼单本（receive）
 * 页面逻辑与另外一页共用 ../book-common.js 的工厂（只做一份），本文件只声明种类。
 */
const { createBookPage } = require('../book-common.js');
Page(createBookPage('receive'));
