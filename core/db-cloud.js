/**
 * 礼单簿 · 云数据库适配器（服务端，wx-server-sdk）
 *
 * 与 MemoryDB 同接口（collection(name) -> {insert,find,findOne,count,update,remove}），
 * core/ 业务代码不感知底层。运行位置：云函数 api 内部（服务端，管理员权限，
 * 不受数据库安全规则限制；权限由 core/authz 在服务端逐条校验）。
 *
 * 实现要点（均为云数据库实测口径）：
 * - 查询 DSL 与 MemoryDB 一致：{field: value} 精确、{$in: []}、{$gte/$lte/$gt/$lt}；
 *   翻译为 db.command；同一字段多个范围条件用 command.and 合并。
 * - find 必须分页拉取：云数据库 get() 单次默认 20 条、上限 100 条，
 *   这里按 100 一批 skip/limit 循环，直到取满 opts.limit 或没有下一批。
 * - insert 带 _id 时用 doc(_id).set()，且 data 里绝不能再含 _id
 *   （含了会被拒：-501007 不能更新_id的值，2026-10-22 init 云函数实测）。
 * - sdk 可注入（测试用假 SDK 在本地跑通全链路）；不注入时懒加载
 *   wx-server-sdk 并 init 到当前环境。
 */

const PAGE = 100;

function translateQuery(cmd, query) {
  const out = {};
  for (const [field, cond] of Object.entries(query || {})) {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)
      && ('$in' in cond || '$gte' in cond || '$lte' in cond || '$gt' in cond || '$lt' in cond)) {
      const ops = [];
      if ('$in' in cond) ops.push(cmd.in(cond.$in));
      if ('$gte' in cond) ops.push(cmd.gte(cond.$gte));
      if ('$lte' in cond) ops.push(cmd.lte(cond.$lte));
      if ('$gt' in cond) ops.push(cmd.gt(cond.$gt));
      if ('$lt' in cond) ops.push(cmd.lt(cond.$lt));
      out[field] = ops.length === 1 ? ops[0] : cmd.and(ops);
    } else {
      out[field] = cond;
    }
  }
  return out;
}

class CloudCollection {
  constructor(db, cmd, name) {
    this._db = db;
    this._cmd = cmd;
    this.name = name;
  }

  _col() { return this._db.collection(this.name); }

  async insert(doc) {
    const data = { ...doc };
    if (data._id) {
      const id = data._id;
      delete data._id;
      await this._col().doc(id).set({ data });
      return { _id: id };
    }
    const res = await this._col().add({ data });
    return { _id: res._id };
  }

  async find(query = {}, opts = {}) {
    let q = this._col().where(translateQuery(this._cmd, query));
    if (opts.sort) {
      const [key, dir] = Object.entries(opts.sort)[0];
      q = q.orderBy(key, dir === -1 ? 'desc' : 'asc');
    }
    const want = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : Infinity;
    const out = [];
    let skip = 0;
    while (out.length < want) {
      const batchSize = Math.min(PAGE, want - out.length);
      const res = await q.skip(skip).limit(batchSize).get();
      const rows = (res && res.data) || [];
      out.push(...rows);
      if (rows.length < batchSize) break;
      skip += rows.length;
    }
    return out;
  }

  async findOne(query = {}) {
    const arr = await this.find(query, { limit: 1 });
    return arr[0] || null;
  }

  async count(query = {}) {
    const res = await this._col().where(translateQuery(this._cmd, query)).count();
    return res.total;
  }

  async update(query, patch) {
    const data = { ...patch };
    delete data._id; // _id 不可更新（同 insert 的实测口径）
    const res = await this._col().where(translateQuery(this._cmd, query)).update({ data });
    return { updated: (res.stats && res.stats.updated) || 0 };
  }

  async remove(query) {
    const res = await this._col().where(translateQuery(this._cmd, query)).remove();
    return { removed: (res.stats && res.stats.removed) || 0 };
  }
}

class CloudDB {
  /** opts.sdk：wx-server-sdk（云函数里 require 后传入；测试注入假 SDK）。
   *  opts.db：直接注入 database() 句柄（优先于 sdk）。 */
  constructor(opts = {}) {
    if (opts.db) {
      this._db = opts.db;
    } else {
      // eslint-disable-next-line global-require
      const sdk = opts.sdk || require('wx-server-sdk');
      if (!opts.sdk) {
        try { sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }); } catch (e) { /* 已初始化则忽略 */ }
      }
      this._db = sdk.database();
    }
    this._cmd = this._db.command;
  }

  collection(name) {
    return new CloudCollection(this._db, this._cmd, name);
  }
}

module.exports = { CloudDB };
