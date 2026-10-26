/**
 * 【文件作用】JSON 文件存储（本项目里的"数据库"）
 * ------------------------------------------------------------
 * 考核要求"商品数据不能全部硬编码在前端页面中"，但演示项目不需要 MySQL。
 * 于是用 JSON 文件当数据表：
 *
 *   server/data/products-商品数据.json     商品（只读）
 *   server/data/categories-商品分类.json   分类（只读）
 *   server/data/carts-购物车数据.json      购物车（运行时自动创建）
 *   server/data/orders-订单数据.json       订单（运行时自动创建）
 *
 * 为了代码好懂，这里用同步读写（readFileSync / writeFileSync）。
 * 数据量只有几十条，完全够用；真实项目应换成数据库 + 异步 IO。
 *
 * 【对应知识点】Node.js fs 模块、path 模块、模块化
 * 【对应考核点】五、数据库要求
 */
const fs = require('node:fs');
const path = require('node:path');

// 测试时可以用 XM_DATA_DIR 指向临时目录，避免污染真实数据
const DATA_DIR = process.env.XM_DATA_DIR
  ? path.resolve(process.env.XM_DATA_DIR)
  : path.join(__dirname, '..', 'data');

// 表名 -> 实际文件名。这样业务代码只写 read('carts')，不用关心文件名。
const FILES = {
  products: 'products-商品数据.json',
  categories: 'categories-商品分类.json',
  carts: 'carts-购物车数据.json',
  orders: 'orders-订单数据.json',
  users: 'users-用户数据.json',
  sessions: 'sessions-用户会话.json',
  conversations: 'conversations-助手会话.json'
};

// 内存缓存：读过的数据先放这里，避免每次都读硬盘
const cache = new Map();

function fileOf(table) {
  const name = FILES[table];
  if (!name) throw new Error('未知的数据表：' + table);
  return path.join(DATA_DIR, name);
}

// Windows 上杀毒软件/索引服务偶尔会短暂占用文件，表现为 EBUSY。
// 这类错误重试几十毫秒就会消失，所以读写都做几次退避重试，避免整次请求失败。
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function withRetry(task, times = 5) {
  let lastError;
  for (let attempt = 0; attempt < times; attempt += 1) {
    try {
      return task();
    } catch (error) {
      lastError = error;
      if (!RETRY_CODES.has(error.code) || attempt === times - 1) throw error;
      const wait = 20 * (attempt + 1);
      const end = Date.now() + wait;
      while (Date.now() < end) { /* 同步等待：这里数据量很小，阻塞几十毫秒可接受 */ }
    }
  }
  throw lastError;
}

/** 读取一张表；文件不存在时用 fallback 初始化 */
function read(table, fallback) {
  if (cache.has(table)) return cache.get(table);
  const file = fileOf(table);
  if (!fs.existsSync(file)) {
    write(table, fallback);
    return cache.get(table);
  }
  // 有些编辑器/脚本会在文件头写 UTF-8 BOM（\uFEFF），JSON.parse 不认识它；
  // 读的时候统一剥掉，避免“文件看起来是 []，服务却报 Unexpected token”。
  const raw = withRetry(() => fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);
  cache.set(table, data);
  return data;
}

/** 写回文件（同时更新内存缓存） */
function write(table, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  withRetry(() => fs.writeFileSync(fileOf(table), JSON.stringify(data, null, 2), 'utf8'));
  cache.set(table, data);
  return data;
}

/** 读 -> 改 -> 写 一步完成 */
function update(table, fallback, updater) {
  const data = read(table, fallback);
  const next = updater(data);
  return write(table, next === undefined ? data : next);
}

module.exports = { read, write, update, DATA_DIR };
