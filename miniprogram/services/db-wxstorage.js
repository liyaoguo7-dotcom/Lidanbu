/**
 * 礼单簿 · 微信本地存储数据库适配器（阶段2 2A）
 *
 * 与 core/db-memory.js 同接口：collection(name) -> {insert,find,findOne,count,update,remove}，
 * 全部 async。数据存在微信本地存储（开发期演示用），云环境就绪后换成 CloudDB，
 * core/ 业务代码与页面代码都不动。
 *
 * storage 后端可注入（默认用 wx），便于在 Node 里用内存对象做测试。
 * 本地模式开关见 config/app-config.js 的 demo.localMode；正式发布前必须关闭
 * （见 docs/发布检查清单）。
 */

function matchValue(docVal, cond) {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$in' in cond) return cond.$in.includes(docVal);
    if ('$gte' in cond && !(docVal >= cond.$gte)) return false;
    if ('$lte' in cond && !(docVal <= cond.$lte)) return false;
    if ('$gt' in cond && !(docVal > cond.$gt)) return false;
    if ('$lt' in cond && !(docVal < cond.$lt)) return false;
    return true;
  }
  return docVal === cond;
}

function matchDoc(doc, query) {
  return Object.entries(query).every(([k, cond]) => matchValue(doc[k], cond));
}

function defaultStorage() {
  return {
    get(k) {
      try { return wx.getStorageSync(k); } catch (e) { return undefined; }
    },
    set(k, v) {
      try { wx.setStorageSync(k, v); } catch (e) { /* 存储满则忽略，调用方可查 */ }
    },
  };
}

class WxStorageCollection {
  constructor(name, storage, prefix) {
    this.name = name;
    this.storage = storage;
    this.key = `${prefix}${name}`;
  }

  _load() {
    const raw = this.storage.get(this.key);
    if (!raw) return { docs: [], seq: 1 };
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && Array.isArray(parsed.docs)) return parsed;
      return { docs: [], seq: 1 };
    } catch (e) {
      return { docs: [], seq: 1 };
    }
  }

  _save(state) {
    this.storage.set(this.key, JSON.stringify(state));
  }

  async insert(doc) {
    const state = this._load();
    const _id = doc._id || `${this.name}_${state.seq++}`;
    state.docs.push({ ...doc, _id });
    this._save(state);
    return { _id };
  }

  async find(query = {}, opts = {}) {
    const state = this._load();
    let arr = state.docs.filter((d) => matchDoc(d, query));
    if (opts.sort) {
      const [key, dir] = Object.entries(opts.sort)[0];
      arr = arr.slice().sort((a, b) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0));
    }
    if (opts.limit) arr = arr.slice(0, opts.limit);
    return arr;
  }

  async findOne(query = {}) {
    const arr = await this.find(query);
    return arr[0] || null;
  }

  async count(query = {}) {
    const arr = await this.find(query);
    return arr.length;
  }

  async update(query, patch) {
    const state = this._load();
    let n = 0;
    state.docs = state.docs.map((d) => {
      if (matchDoc(d, query)) { n += 1; return { ...d, ...patch }; }
      return d;
    });
    this._save(state);
    return { updated: n };
  }

  async remove(query) {
    const state = this._load();
    const before = state.docs.length;
    state.docs = state.docs.filter((d) => !matchDoc(d, query));
    this._save(state);
    return { removed: before - state.docs.length };
  }
}

class WxStorageDB {
  constructor(storage, prefix = 'lidanbu_db_') {
    this._storage = storage || defaultStorage();
    this._prefix = prefix;
    this._cols = new Map();
  }

  collection(name) {
    if (!this._cols.has(name)) {
      this._cols.set(name, new WxStorageCollection(name, this._storage, this._prefix));
    }
    return this._cols.get(name);
  }
}

module.exports = { WxStorageDB, WxStorageCollection };
