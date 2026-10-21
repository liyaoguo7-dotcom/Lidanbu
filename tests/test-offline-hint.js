/**
 * 弱网/离线文案测试（任务N 质量回归）：
 * data-service 的网络错误识别必须命中云函数/请求失败类错误，
 * 且不误伤业务错误（业务文案仍走 friendly 原样透出规则，不被吞成网络文案）。
 * data-service 顶层会读 wx 全局，这里给最小桩。
 */
global.wx = global.wx || {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
};
const { test, assert } = require('./fw');
const dataService = require('../miniprogram/services/data-service');

test('离线文案：云函数/请求失败类错误识别为网络错误', async () => {
  const f = dataService._isNetworkError;
  assert(typeof f === 'function', '识别函数已导出');
  assert(f(new Error('cloud.callFunction:fail request:fail timeout')), 'callFunction 超时');
  assert(f({ errMsg: 'request:fail net::ERR_INTERNET_DISCONNECTED' }), 'errMsg 网络失败');
  assert(f(new Error('request:fail abort')), 'request abort');
  assert(dataService.NETWORK_HINT.includes('网络不太顺'), '提示文案是大白话网络口径');
});

test('离线文案：业务错误不误判为网络错误', async () => {
  const f = dataService._isNetworkError;
  assert(!f(new Error('额度已达上限')), '额度错误不误判');
  assert(!f(new Error('无权限：这条记录不是你的')), '权限错误不误判');
  assert(!f(new Error('需要开通会员')), '会员错误不误判');
  assert(!f(null) && !f(undefined), '空错误不误判');
});
