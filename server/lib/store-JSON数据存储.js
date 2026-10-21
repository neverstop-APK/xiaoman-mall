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

const DATA_DIR = path.join(__dirname, '..', 'data');

// 表名 -> 实际文件名。这样业务代码只写 read('carts')，不用关心文件名。
const FILES = {
  products: 'products-商品数据.json',
  categories: 'categories-商品分类.json',
  carts: 'carts-购物车数据.json',
  orders: 'orders-订单数据.json'
};

// 内存缓存：读过的数据先放这里，避免每次都读硬盘
const cache = new Map();

function fileOf(table) {
  const name = FILES[table];
  if (!name) throw new Error('未知的数据表：' + table);
  return path.join(DATA_DIR, name);
}

/** 读取一张表；文件不存在时用 fallback 初始化 */
function read(table, fallback) {
  if (cache.has(table)) return cache.get(table);
  const file = fileOf(table);
  if (!fs.existsSync(file)) {
    write(table, fallback);
    return cache.get(table);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(table, data);
  return data;
}

/** 写回文件（同时更新内存缓存） */
function write(table, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileOf(table), JSON.stringify(data, null, 2), 'utf8');
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
