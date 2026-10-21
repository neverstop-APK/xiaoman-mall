/**
 * Test helpers — temporary XM_DATA_DIR and JSON table files.
 * 【文件作用】测试辅助：建临时数据目录、写数据表、复制种子数据、清理目录。
 * ------------------------------------------------------------
 * 单元测试和接口测试都必须满足两个条件：
 *   1. 不能污染 server/data（那里是演示用的真实数据）；
 *   2. 每个测试文件互不影响。
 * 做法是给每个测试文件用 mkdtemp 建一个独立目录，写进 XM_DATA_DIR，
 * 测试结束再整个删掉。
 *
 * 【顺序很重要】
 * store-JSON数据存储.js 在模块加载时就把 DATA_DIR 定了下来，
 * 所以一定要"先设置 XM_DATA_DIR，再 require 业务模块"，反过来无效。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 表名 -> 文件名，必须和 server/lib/store-JSON数据存储.js 里的 FILES 保持一致 */
export const TABLE_FILES = Object.freeze({
  products: 'products-商品数据.json',
  categories: 'categories-商品分类.json',
  carts: 'carts-购物车数据.json',
  orders: 'orders-订单数据.json',
  users: 'users-用户数据.json',
  sessions: 'sessions-用户会话.json',
  conversations: 'conversations-助手会话.json'
});

/** 建临时目录，同时把它设为进程级 XM_DATA_DIR */
export function makeTempDataDir(prefix = 'xm-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.XM_DATA_DIR = dir;
  return dir;
}

/** 往临时目录里写一张表；只在 require 业务模块之前使用 */
export function writeTableFile(dir, table, data) {
  const fileName = TABLE_FILES[table];
  if (!fileName) throw new Error('未知的数据表：' + table);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2), 'utf8');
}

/** 一次写多张表 */
export function seedTables(dir, tables) {
  for (const [table, data] of Object.entries(tables)) writeTableFile(dir, table, data);
}

/** 把 server/data 里的真实商品/分类复制到临时目录（接口测试用） */
export function copySeedTable(sourceDir, targetDir, table) {
  const fileName = TABLE_FILES[table];
  if (!fileName) throw new Error('未知的数据表：' + table);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}

/** 删临时目录；Windows 上偶尔有杀不掉的句柄，所以带重试 */
export function removeTempDir(dir) {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
}

/** 简单的异步等待 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
