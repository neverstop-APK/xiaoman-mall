/**
 * Unit tests for server/services/catalog-商品查询服务.js.
 * Covers keyword search, category / price filters, sorting, pagination and detail 404.
 * 【文件作用】商品查询服务的单元测试。
 * 【测什么】关键词、分类、价格区间、排序、分页、详情 404，以及分类计数/推荐/相关推荐/价格区间。
 * 【怎么跑】node --test tests/unit/catalog-商品查询服务.test.mjs
 * 【数据】本文件在 require 服务之前先把 6 件测试商品写进临时 XM_DATA_DIR，
 *         不会碰 server/data 里的真实商品。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeTempDataDir, seedTables, removeTempDir } from '../测试辅助-临时数据目录.mjs';

const require = createRequire(import.meta.url);
const SERVER_DIR = fileURLToPath(new URL('../../server/', import.meta.url));

/** 测试商品：价格、销量、评分、上架时间都特意做成互不相同，方便断言排序 */
const PRODUCTS = [
  {
    id: 't01', name: '测试蓝牙耳机', brand: 'TestBrand', category: '数码', price: 100,
    stock: 5, sales: 10, rating: 4.5, createdAt: '2026-01-01T00:00:00.000Z',
    tags: ['运动'], keywords: ['耳机', '无线耳机'], summary: '测试用蓝牙耳机', emoji: '🎧', cover: ''
  },
  {
    id: 't02', name: '测试降噪耳机', brand: '声学实验室', category: '数码', price: 300,
    stock: 8, sales: 50, rating: 4.9, createdAt: '2026-03-01T00:00:00.000Z',
    tags: ['降噪'], keywords: ['耳机', '头戴耳机'], summary: '头戴式降噪耳机', emoji: '🎧', cover: ''
  },
  {
    id: 't03', name: '测试机械键盘', brand: '键盘工坊', category: '数码', price: 200,
    stock: 2, sales: 30, rating: 4.2, createdAt: '2026-02-01T00:00:00.000Z',
    tags: ['机械键盘'], keywords: ['键盘', '外设'], summary: '青轴机械键盘', emoji: '⌨️', cover: ''
  },
  {
    id: 't04', name: '测试香薰蜡烛', brand: '居家小铺', category: '家居', price: 50,
    stock: 20, sales: 5, rating: 4.0, createdAt: '2026-04-01T00:00:00.000Z',
    tags: ['香薰'], keywords: ['蜡烛', '香氛'], summary: '大豆蜡香薰', emoji: '🕯️', cover: ''
  },
  {
    id: 't05', name: '测试马克杯', brand: '居家小铺', category: '家居', price: 80,
    stock: 12, sales: 20, rating: 4.6, createdAt: '2026-05-01T00:00:00.000Z',
    tags: ['杯子'], keywords: ['马克杯', '水杯'], summary: '陶瓷马克杯', emoji: '☕', cover: ''
  },
  {
    id: 't06', name: '测试双肩包', brand: '出行装备', category: '户外', price: 150,
    stock: 6, sales: 40, rating: 4.4, createdAt: '2026-06-01T00:00:00.000Z',
    tags: ['背包'], keywords: ['双肩包', '旅行'], summary: '轻量通勤双肩包', emoji: '🎒', cover: ''
  }
];

const CATEGORIES = [
  { key: '数码', label: '数码', emoji: '🎧' },
  { key: '家居', label: '家居', emoji: '🕯️' },
  { key: '户外', label: '户外', emoji: '🎒' }
];

const dataDir = makeTempDataDir('xm-catalog-');
seedTables(dataDir, { products: PRODUCTS, categories: CATEGORIES });

const catalog = require(path.join(SERVER_DIR, 'services', 'catalog-商品查询服务.js'));

after(() => removeTempDir(dataDir));

/** 统一断言 HttpError 的 status 与业务 code，避免每个用例重复写 try/catch */
function assertHttpError(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, 'HttpError');
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

test('query：不带参数时返回全部商品与默认分页信息', () => {
  const result = catalog.query();

  assert.equal(result.total, 6);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 12);
  assert.equal(result.totalPages, 1);
  assert.equal(result.sort, 'default');
  assert.deepEqual(result.filters, { keyword: '', category: 'all', minPrice: null, maxPrice: null });
  assert.deepEqual(result.list.map((item) => item.id), ['t01', 't02', 't03', 't04', 't05', 't06']);
});

test('query：关键词匹配名称、品牌、标签与搜索词，忽略大小写和首尾空格', () => {
  assert.deepEqual(catalog.query({ keyword: '耳机' }).list.map((item) => item.id), ['t01', 't02']);
  assert.deepEqual(catalog.query({ keyword: 'testbrand' }).list.map((item) => item.id), ['t01']);
  assert.deepEqual(catalog.query({ keyword: '  蓝牙  ' }).list.map((item) => item.id), ['t01']);
  assert.deepEqual(catalog.query({ keyword: '旅行' }).list.map((item) => item.id), ['t06']);

  const empty = catalog.query({ keyword: '不存在的商品' });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.list, []);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.filters.keyword, '不存在的商品');
});

test('query：分类筛选，category=all 等同于不筛选', () => {
  assert.deepEqual(catalog.query({ category: '家居' }).list.map((item) => item.id), ['t04', 't05']);
  assert.equal(catalog.query({ category: 'all' }).total, 6);
  assert.equal(catalog.query({ category: '不存在的分类' }).total, 0);
  assert.equal(catalog.query({ category: '家居' }).filters.category, '家居');
});

test('query：价格区间闭区间过滤，边界值包含在内', () => {
  const ranged = catalog.query({ minPrice: 80, maxPrice: 200 });
  assert.deepEqual(ranged.list.map((item) => item.id), ['t01', 't03', 't05', 't06']);
  assert.ok(ranged.list.every((item) => item.price >= 80 && item.price <= 200));

  assert.deepEqual(catalog.query({ minPrice: 100, maxPrice: 100 }).list.map((item) => item.id), ['t01']);
  assert.deepEqual(catalog.query({ minPrice: 0, maxPrice: 60 }).list.map((item) => item.id), ['t04']);
  assert.equal(catalog.query({ minPrice: 80, maxPrice: 200 }).filters.minPrice, 80);
  assert.equal(catalog.query({ minPrice: 80, maxPrice: 200 }).filters.maxPrice, 200);
});

test('query：价格、页码、每页数量非法时抛 400/40011，区间倒置抛 400/40012', () => {
  assertHttpError(() => catalog.query({ minPrice: 'abc' }), 400, 40011);
  assertHttpError(() => catalog.query({ maxPrice: -1 }), 400, 40011);
  assertHttpError(() => catalog.query({ page: 0 }), 400, 40011);
  assertHttpError(() => catalog.query({ pageSize: 0 }), 400, 40011);
  assertHttpError(() => catalog.query({ pageSize: 61 }), 400, 40011);
  assertHttpError(() => catalog.query({ minPrice: 300, maxPrice: 100 }), 400, 40012);
});

test('query：五种排序都按预期生效，未知排序回落到 default', () => {
  assert.deepEqual(
    catalog.query({ sort: 'price-asc', pageSize: 60 }).list.map((item) => item.price),
    [50, 80, 100, 150, 200, 300]
  );
  assert.deepEqual(
    catalog.query({ sort: 'price-desc', pageSize: 60 }).list.map((item) => item.price),
    [300, 200, 150, 100, 80, 50]
  );
  assert.deepEqual(
    catalog.query({ sort: 'sales-desc', pageSize: 60 }).list.map((item) => item.id),
    ['t02', 't06', 't03', 't05', 't01', 't04']
  );
  assert.deepEqual(
    catalog.query({ sort: 'rating-desc', pageSize: 60 }).list.map((item) => item.id),
    ['t02', 't05', 't01', 't06', 't03', 't04']
  );
  assert.equal(catalog.query({ sort: 'newest', pageSize: 60 }).list[0].id, 't06');
  assert.equal(catalog.query({ sort: 'price-asc' }).sort, 'price-asc');
  assert.equal(catalog.query({ sort: '不存在的排序' }).sort, 'default');
});

test('query：分页取第二页，页码超出上限时钳制到最后一页', () => {
  const page2 = catalog.query({ page: 2, pageSize: 2 });
  assert.equal(page2.total, 6);
  assert.equal(page2.totalPages, 3);
  assert.deepEqual(page2.list.map((item) => item.id), ['t03', 't04']);

  const lastPage = catalog.query({ page: 99, pageSize: 2 });
  assert.equal(lastPage.page, 3);
  assert.deepEqual(lastPage.list.map((item) => item.id), ['t05', 't06']);

  const single = catalog.query({ page: 6, pageSize: 1 });
  assert.deepEqual(single.list.map((item) => item.id), ['t06']);
});

test('getById：命中返回商品，未命中抛 404/40401', () => {
  const found = catalog.getById('t01');
  assert.equal(found.id, 't01');
  assert.equal(found.name, '测试蓝牙耳机');
  assert.equal(found.price, 100);

  assertHttpError(() => catalog.getById('t99'), 404, 40401);
});

test('categories / recommendations / related / priceRange：辅助查询正确', () => {
  const categories = catalog.categories();
  assert.equal(categories.length, 3);
  assert.deepEqual(categories.map((item) => [item.key, item.count]), [
    ['数码', 3],
    ['家居', 2],
    ['户外', 1]
  ]);
  assert.equal(categories[0].label, '数码');

  assert.deepEqual(catalog.recommendations(2).map((item) => item.id), ['t02', 't06']);
  assert.equal(catalog.recommendations().length, 4);

  assert.deepEqual(catalog.related('t01').map((item) => item.id), ['t02', 't03']);
  assert.deepEqual(catalog.related('t04').map((item) => item.id), ['t05']);

  assert.deepEqual(catalog.priceRange(), { min: 50, max: 300 });
});
