/**
 * 假 wx-server-sdk（仅测试用）：在本地内存里模拟云数据库的行为口径，
 * 让 CloudDB 与 api 云函数分发能在无云环境时跑通全链路测试。
 * 模拟范围＝CloudDB 实际用到的面：command(in/gte/gt/lte/lt/and)、
 * collection.add/doc.set/doc.get/where+orderBy+skip+limit+get/count/update/remove。
 * 注意 get() 单次上限 100 条（与真实云数据库一致，逼 CloudDB 分页）。
 */

function makeCommand() {
  return {
    in: (arr) => ({ __op: 'in', arr }),
    gte: (v) => ({ __op: 'gte', v }),
    gt: (v) => ({ __op: 'gt', v }),
    lte: (v) => ({ __op: 'lte', v }),
    lt: (v) => ({ __op: 'lt', v }),
    and: (ops) => ({ __op: 'and', ops }),
  };
}

function matchCond(docVal, cond) {
  if (cond !== null && typeof cond === 'object' && cond.__op) {
    switch (cond.__op) {
      case 'in': return cond.arr.includes(docVal);
      case 'gte': return docVal >= cond.v;
      case 'gt': return docVal > cond.v;
      case 'lte': return docVal <= cond.v;
      case 'lt': return docVal < cond.v;
      case 'and': return cond.ops.every((op) => matchCond(docVal, op));
      default: return false;
    }
  }
  return docVal === cond;
}

function matchDoc(doc, query) {
  return Object.entries(query || {}).every(([k, cond]) => matchCond(doc[k], cond));
}

class FakeQuery {
  constructor(store, query) {
    this._store = store;
    this._query = query;
    this._sort = null;
    this._skip = 0;
    this._limit = 100;
  }

  orderBy(key, dir) { this._sort = [key, dir]; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = Math.min(n, 100); return this; }

  _rows() {
    let arr = [...this._store.values()].filter((d) => matchDoc(d, this._query));
    if (this._sort) {
      const [key, dir] = this._sort;
      const s = dir === 'desc' ? -1 : 1;
      arr.sort((a, b) => (a[key] < b[key] ? -s : a[key] > b[key] ? s : 0));
    }
    return arr;
  }

  async get() {
    const arr = this._rows().slice(this._skip, this._skip + this._limit);
    return { data: arr.map((d) => ({ ...d })) };
  }

  async count() { return { total: this._rows().length }; }

  async update({ data }) {
    const arr = this._rows();
    arr.forEach((d) => Object.assign(d, data));
    return { stats: { updated: arr.length } };
  }

  async remove() {
    const arr = this._rows();
    arr.forEach((d) => this._store.delete(d._id));
    return { stats: { removed: arr.length } };
  }
}

class FakeCollection {
  constructor(store, seqRef) {
    this._store = store;
    this._seqRef = seqRef;
  }

  async add({ data }) {
    const _id = `fake_${++this._seqRef.n}`;
    this._store.set(_id, { ...data, _id });
    return { _id };
  }

  doc(id) {
    const store = this._store;
    return {
      async set({ data }) {
        if (data && '_id' in data) throw new Error('document.set:fail -501007 不能更新_id的值');
        store.set(id, { ...data, _id: id });
        return {};
      },
      async get() {
        const d = store.get(id);
        if (!d) throw new Error('document.get:fail document not exist');
        return { data: { ...d } };
      },
    };
  }

  where(query) { return new FakeQuery(this._store, query); }
}

function makeFakeSdk() {
  const stores = new Map();
  const seqRef = { n: 0 };
  const command = makeCommand();
  const db = {
    command,
    collection(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return new FakeCollection(stores.get(name), seqRef);
    },
  };
  return {
    DYNAMIC_CURRENT_ENV: 'fake-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: makeFakeSdk.currentOpenid || 'fake-openid' }),
    __stores: stores,
  };
}
makeFakeSdk.currentOpenid = 'fake-openid';

module.exports = { makeFakeSdk };
