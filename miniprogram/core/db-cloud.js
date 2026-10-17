/**
* 礼单簿 · 云数据库适配器（T1.1，只写不测）
*
* 与 MemoryDB 同接口（collection(name) -> {insert,find,findOne,count,update,remove}），
* 云环境到位后联调。当前无云环境，以下代码未经实际运行，标记。
*
* 注意：部署时把 miniprogram/config/app-config.js 复制到云函数可访问位置，
* core/config.js 负责解析（本地直接 require，云端用复制件）。
*/

// 以下为云函数环境代码，本地 Node 无法运行 wx.cloud
// const cloud = require('wx-server-sdk');
// cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV});
// const db = cloud.database();

function notReady(name) {
throw new Error(`[CloudDB待联调] ${name}：需云环境到位后联调，当前不可用`);
}

class CloudCollection {
constructor(name) {
this.name = name;
}
async insert() { notReady(`${this.name}.insert`);}
async find() { notReady(`${this.name}.find`);}
async findOne() { notReady(`${this.name}.findOne`);}
async count() { notReady(`${this.name}.count`);}
async update() { notReady(`${this.name}.update`);}
async remove() { notReady(`${this.name}.remove`);}
}

class CloudDB {
collection(name) {
return new CloudCollection(name);
}
}

module.exports = { CloudDB};
