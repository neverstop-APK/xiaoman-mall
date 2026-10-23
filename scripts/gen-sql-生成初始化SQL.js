#!/usr/bin/env node
/**
 * 【文件作用】把 server/data 里的商品/分类 JSON 生成一份初始 SQL
 * ------------------------------------------------------------
 * 为什么需要它：
 *   项目运行时用 JSON 文件，零依赖；但课程提交要求附初始 SQL，
 *   所以这里生成一份等价的 SQLite 初始库（表结构 + 26 件商品 + 6 个分类）。
 *   SQL 和 JSON 来自同一份数据，不会出现“文档 26 件、SQL 少两件”的情况。
 *
 * 用法：npm run sql
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, 'server', 'data', name), 'utf8'));
const products = readJson('products-商品数据.json');
const categories = readJson('categories-商品分类.json');

const q = (value) => {
  if (value === null || value === undefined) return 'NULL';
  return "'" + String(value).replace(/'/g, "''") + "'";
};
const num = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? 'NULL' : String(Number(value)));
const json = (value) => q(JSON.stringify(value || []));

const lines = [];
lines.push('-- =============================================================================');
lines.push('-- 小满商城 · 初始 SQL（SQLite 3）');
lines.push('-- =============================================================================');
lines.push('-- 这份文件做什么：');
lines.push('--   建表 + 写入 6 个分类、26 件商品。');
lines.push('--   商品/分类与 server/data/*.json 一一对应，由 scripts/gen-sql-生成初始化SQL.js 生成。');
lines.push('--');
lines.push('-- 重要说明：');
lines.push('--   当前 Node 后端为了“零依赖、克隆即跑”，运行时读写的是 JSON 文件；');
lines.push('--   这份 SQL 是可执行的等价初始库，供课程提交、评审、以后迁移数据库使用。');
lines.push('--   换成 SQLite/MySQL 时，service 层的业务规则不用改，只替换 store 的读写实现。');
lines.push('--');
lines.push('-- 本地试跑：');
lines.push('--   sqlite3 /tmp/xiaoman-mall.db < server/sql/init-初始化数据.sql');
lines.push('--   sqlite3 /tmp/xiaoman-mall.db "select count(*) from products;"');
lines.push('--');
lines.push('-- 注：这份文件按 SQLite 3 语法生成，可直接执行；');
lines.push('--     若要导入 MySQL，TEXT 主键需改成 VARCHAR(32)，order_items.id 改成 INT AUTO_INCREMENT，');
lines.push('--     其余字段类型按 MySQL 习惯对应调整。');
lines.push('-- =============================================================================');
lines.push('');
lines.push('PRAGMA foreign_keys = ON;');
lines.push('BEGIN TRANSACTION;');
lines.push('');
lines.push('DROP TABLE IF EXISTS order_items;');
lines.push('DROP TABLE IF EXISTS orders;');
lines.push('DROP TABLE IF EXISTS cart_items;');
lines.push('DROP TABLE IF EXISTS carts;');
lines.push('DROP TABLE IF EXISTS sessions;');
lines.push('DROP TABLE IF EXISTS users;');
lines.push('DROP TABLE IF EXISTS products;');
lines.push('DROP TABLE IF EXISTS categories;');
lines.push('');
lines.push('CREATE TABLE categories (');
lines.push('  key         TEXT PRIMARY KEY,');
lines.push("  label       TEXT NOT NULL,");
lines.push("  emoji       TEXT NOT NULL DEFAULT '',");
lines.push("  description TEXT NOT NULL DEFAULT '',");
lines.push('  sort_order  INTEGER NOT NULL DEFAULT 0');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE products (');
lines.push('  id             TEXT PRIMARY KEY,');
lines.push('  name           TEXT NOT NULL,');
lines.push("  brand          TEXT NOT NULL DEFAULT '',");
lines.push('  category_key   TEXT NOT NULL,');
lines.push("  sub_category   TEXT NOT NULL DEFAULT '',");
lines.push('  price          REAL NOT NULL CHECK (price >= 0),');
lines.push('  original_price REAL,');
lines.push('  stock          INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),');
lines.push('  rating         REAL NOT NULL DEFAULT 0,');
lines.push('  sales          INTEGER NOT NULL DEFAULT 0,');
lines.push("  emoji          TEXT NOT NULL DEFAULT '',");
lines.push("  summary        TEXT NOT NULL DEFAULT '',");
lines.push("  description    TEXT NOT NULL DEFAULT '',");
lines.push('  features_json  TEXT NOT NULL DEFAULT \'[]\',');
lines.push('  tags_json      TEXT NOT NULL DEFAULT \'[]\',');
lines.push('  keywords_json  TEXT NOT NULL DEFAULT \'[]\',');
lines.push("  cover          TEXT NOT NULL DEFAULT '',");
lines.push('  created_at     TEXT,');
lines.push('  FOREIGN KEY (category_key) REFERENCES categories(key)');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE users (');
lines.push('  id            TEXT PRIMARY KEY,');
lines.push('  username      TEXT NOT NULL UNIQUE,');
lines.push('  nickname      TEXT NOT NULL,');
lines.push('  salt          TEXT NOT NULL,');
lines.push('  password_hash TEXT NOT NULL,');
lines.push('  created_at    TEXT NOT NULL,');
lines.push('  last_login_at TEXT');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE sessions (');
lines.push('  token_hash TEXT PRIMARY KEY,');
lines.push('  user_id    TEXT NOT NULL,');
lines.push('  created_at TEXT NOT NULL,');
lines.push('  expires_at INTEGER NOT NULL,');
lines.push('  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE carts (');
lines.push('  id         TEXT PRIMARY KEY,');
lines.push('  created_at TEXT NOT NULL,');
lines.push('  updated_at TEXT NOT NULL');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE cart_items (');
lines.push('  cart_id    TEXT NOT NULL,');
lines.push('  product_id TEXT NOT NULL,');
lines.push('  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),');
lines.push('  PRIMARY KEY (cart_id, product_id),');
lines.push('  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,');
lines.push('  FOREIGN KEY (product_id) REFERENCES products(id)');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE orders (');
lines.push('  id               TEXT PRIMARY KEY,');
lines.push('  user_id          TEXT,');
lines.push("  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),");
lines.push('  goods_amount     REAL NOT NULL,');
lines.push('  shipping_fee     REAL NOT NULL DEFAULT 0,');
lines.push('  total_amount     REAL NOT NULL,');
lines.push('  total_quantity   INTEGER NOT NULL,');
lines.push("  payment_method   TEXT NOT NULL DEFAULT 'mock',");
lines.push("  receiver_name    TEXT NOT NULL DEFAULT '',");
lines.push("  receiver_phone   TEXT NOT NULL DEFAULT '',");
lines.push("  receiver_address TEXT NOT NULL DEFAULT '',");
lines.push("  remark           TEXT NOT NULL DEFAULT '',");
lines.push('  cart_id          TEXT,');
lines.push('  created_at       TEXT NOT NULL,');
lines.push('  paid_at          TEXT,');
lines.push('  cancelled_at     TEXT,');
lines.push('  FOREIGN KEY (user_id) REFERENCES users(id)');
lines.push(');');
lines.push('');
lines.push('CREATE TABLE order_items (');
lines.push('  id         INTEGER PRIMARY KEY AUTOINCREMENT,');
lines.push('  order_id   TEXT NOT NULL,');
lines.push('  product_id TEXT NOT NULL,');
lines.push('  name       TEXT NOT NULL,');
lines.push("  emoji      TEXT NOT NULL DEFAULT '',");
lines.push("  cover      TEXT NOT NULL DEFAULT '',");
lines.push('  price      REAL NOT NULL,');
lines.push('  quantity   INTEGER NOT NULL CHECK (quantity >= 1),');
lines.push('  subtotal   REAL NOT NULL,');
lines.push('  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,');
lines.push('  FOREIGN KEY (product_id) REFERENCES products(id)');
lines.push(');');
lines.push('');
lines.push('CREATE INDEX idx_products_category ON products(category_key);');
lines.push('CREATE INDEX idx_products_sales ON products(sales DESC);');
lines.push('CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);');
lines.push('CREATE INDEX idx_sessions_user ON sessions(user_id);');
lines.push('CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);');
lines.push('');
lines.push('-- 6 个分类');
for (let i = 0; i < categories.length; i += 1) {
  const c = categories[i];
  lines.push('INSERT INTO categories (key, label, emoji, description, sort_order) VALUES (' +
    [q(c.key), q(c.label), q(c.emoji), q(c.desc), i + 1].join(', ') + ');');
}
lines.push('');
lines.push('-- 下面两张表是种子数据；users / sessions / carts / orders / order_items 为空，');
lines.push('-- 由程序在注册、加购、下单时写入，所以这里不插示例账号或订单。');
lines.push('');
lines.push('-- 26 件商品');
for (const p of products) {
  lines.push('INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES (' +
    [
      q(p.id), q(p.name), q(p.brand), q(p.category), q(p.subCategory), num(p.price), num(p.originalPrice),
      num(p.stock), num(p.rating), num(p.sales), q(p.emoji), q(p.summary), q(p.description),
      json(p.features), json(p.tags), json(p.keywords), q(p.cover), q(p.createdAt)
    ].join(', ') + ');');
}
lines.push('');
lines.push('COMMIT;');
lines.push('');
lines.push('-- 自检：应为 6 和 26');
lines.push('-- SELECT (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM products) AS products;');

const out = path.join(root, 'server', 'sql', 'init-初始化数据.sql');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log('已生成 ' + out);
console.log('分类 ' + categories.length + ' 个，商品 ' + products.length + ' 件');
