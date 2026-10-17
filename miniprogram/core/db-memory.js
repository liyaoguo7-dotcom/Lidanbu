/**
 * 礼单簿 · 内存数据库（T1.1）
 *
 * 用途：无云环境时本地运行核心规则与权限矩阵测试。
 * 接口与云数据库适配器（db-cloud.js）保持一致，均为 async，
 * 云环境到位后把 MemoryDB 换成 CloudDB 即可联调，core/ 业务代码不动。
 *
 * 支持的查询：{field: value} 精确匹配；{field: {$in: []}}；
 * {field: {$gte/$lte/$gt/$lt: v}} 范围（日期/数字）。
 */

// eslint-disable-next-line no-unused-vars
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

class MemoryCollection {
  constructor(name) {
    this.name = name;
    this.docs = new Map();
    this.seq = 1;
  }

  async insert(doc) {
    const _id = doc._id || `${this.name}_${this.seq++}`;
    const saved = { ...doc, _id };
    this.docs.set(_id, saved);
    return { _id };
  }

  async find(query = {}, opts = {}) {
    let arr = [...this.docs.values()].filter((d) => matchDoc(d, query));
    if (opts.sort) {
      const [key, dir] = Object.entries(opts.sort)[0];
      arr.sort((a, b) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0));
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
    const arr = await this.find(query);
    arr.forEach((d) => {
      Object.assign(d, patch);
      this.docs.set(d._id, d);
    });
    return { updated: arr.length };
  }

  async remove(query) {
    const arr = await this.find(query);
    arr.forEach((d) => this.docs.delete(d._id));
    return { removed: arr.length };
  }
}

class MemoryDB {
  constructor() {
    this._cols = new Map();
  }

  collection(name) {
    if (!this._cols.has(name)) this._cols.set(name, new MemoryCollection(name));
    return this._cols.get(name);
  }
}

module.exports = { MemoryDB };
