/**
 * Unit tests for server/services/cart-购物车服务.js.
 * Covers add / accumulate / stock cap / update to zero / remove / clear / subtotal rounding.
 * 【文件作用】购物车服务的单元测试。
 * 【测什么】加购、同商品累加、库存上限、数量改成 0 删除、移除、清空、金额小计，
 *           以及商品已下架时购物车如何降级展示。
 * 【怎么跑】node --test tests/unit/cart-购物车服务.test.mjs
 * 【数据】c01 库存 3、c02 库存 5、c03 已售罄；每个用例开始前重置商品与购物车两张表。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeTempDataDir, seedTables, removeTempDir } from '../测试辅助-临时数据目录.mjs';

const require = createRequire(import.meta.url);
const SERVER_DIR = fileURLToPath(new URL('../../server/', import.meta.url));

const PRODUCTS = [
  {
    id: 'c01', name: '测试真无线耳机', price: 29.9, stock: 3, sales: 0,
    category: '数码', emoji: '🎧', cover: '', summary: '测试用耳机'
  },
  {
    id: 'c02', name: '测试机械键盘', price: 100, stock: 5, sales: 0,
    category: '数码', emoji: '⌨️', cover: '', summary: '测试用键盘'
  },
  {
    id: 'c03', name: '测试香薰蜡烛', price: 69, stock: 0, sales: 0,
    category: '家居', emoji: '🕯️', cover: '', summary: '已售罄的测试商品'
  }
];

const dataDir = makeTempDataDir('xm-cart-');
seedTables(dataDir, { products: PRODUCTS, carts: [] });

const store = require(path.join(SERVER_DIR, 'lib', 'store-JSON数据存储.js'));
const cartService = require(path.join(SERVER_DIR, 'services', 'cart-购物车服务.js'));

after(() => removeTempDir(dataDir));

/** 每个用例都从干净的商品与购物车数据开始，避免用例之间互相影响 */
function resetData() {
  store.write('products', structuredClone(PRODUCTS));
  store.write('carts', []);
}

function assertHttpError(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, 'HttpError');
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

test('get：没有购物车时自动创建一个空购物车并落盘', () => {
  const cart = cartService.get();

  assert.match(cart.id, /^cart_[0-9a-f]{12}$/);
  assert.deepEqual(cart.items, []);
  assert.equal(cart.totalQuantity, 0);
  assert.equal(cart.totalAmount, 0);

  const saved = store.read('carts', []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, cart.id);
});

test('addItem：同一商品再次加购时累加数量，而不是新增一行', () => {
  resetData();

  let cart = cartService.addItem(null, 'c01', 2);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].productId, 'c01');
  assert.equal(cart.items[0].quantity, 2);
  assert.equal(cart.items[0].subtotal, 59.8);
  assert.equal(cart.totalQuantity, 2);
  assert.equal(cart.totalAmount, 59.8);

  cart = cartService.addItem(cart.id, 'c01', 1);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 3);
  assert.equal(cart.totalQuantity, 3);
  assert.equal(cart.totalAmount, 89.7);
});

test('addItem：累加后超过库存返回 409/40902，且不写入购物车', () => {
  resetData();

  const cart = cartService.addItem(null, 'c01', 2);
  assertHttpError(() => cartService.addItem(cart.id, 'c01', 2), 409, 40902);

  const saved = store.read('carts', []).find((item) => item.id === cart.id);
  assert.equal(saved.items[0].quantity, 2);
  assert.equal(cartService.get(cart.id).totalQuantity, 2);
});

test('addItem：数量、库存、商品合法性校验分别返回 400 / 409 / 404', () => {
  resetData();

  assertHttpError(() => cartService.addItem(null, 'c02', 6), 409, 40902);
  assertHttpError(() => cartService.addItem(null, 'c02', 100), 400, 40021);
  assertHttpError(() => cartService.addItem(null, 'c02', 0), 400, 40021);
  assertHttpError(() => cartService.addItem(null, 'c02', 1.5), 400, 40021);
  assertHttpError(() => cartService.addItem(null, 'c99', 1), 404, 40401);
  assertHttpError(() => cartService.addItem(null, 'c03', 1), 409, 40901);

  // 失败后购物车内容保持为空：失败只会留下一个空购物车，不会留下半条明细
  const carts = store.read('carts', []);
  assert.ok(carts.every((cart) => cart.items.length === 0));
});

test('updateItem：改数量按新数量计费，改成 0 等价于删除', () => {
  resetData();

  let cart = cartService.addItem(null, 'c01', 1);
  assert.equal(cart.totalAmount, 29.9);

  cart = cartService.updateItem(cart.id, 'c01', 2);
  assert.equal(cart.items[0].quantity, 2);
  assert.equal(cart.totalAmount, 59.8);

  cart = cartService.updateItem(cart.id, 'c01', 3);
  assert.equal(cart.items[0].quantity, 3);
  assert.equal(cart.totalAmount, 89.7);

  cart = cartService.updateItem(cart.id, 'c01', 0);
  assert.deepEqual(cart.items, []);
  assert.equal(cart.totalQuantity, 0);
  assert.equal(cart.totalAmount, 0);
});

test('updateItem：购物车里没有的商品抛 404/40402，超库存抛 409/40902', () => {
  resetData();

  const cart = cartService.addItem(null, 'c01', 1);
  assertHttpError(() => cartService.updateItem(cart.id, 'c01', 4), 409, 40902);
  assertHttpError(() => cartService.updateItem(cart.id, 'c02', 1), 404, 40402);
});

test('removeItem / clear：删除单项后保留其他商品，清空后数量金额归零', () => {
  resetData();

  let cart = cartService.addItem(null, 'c01', 1);
  cart = cartService.addItem(cart.id, 'c02', 2);
  assert.deepEqual(cart.items.map((item) => item.productId), ['c01', 'c02']);
  assert.equal(cart.totalAmount, 229.9);

  const removed = cartService.removeItem(cart.id, 'c01');
  assert.deepEqual(removed.items.map((item) => item.productId), ['c02']);
  assert.equal(removed.totalAmount, 200);

  // 删除不存在的行不报错，原样返回
  const same = cartService.removeItem(cart.id, 'c99');
  assert.deepEqual(same.items.map((item) => item.productId), ['c02']);

  const cleared = cartService.clear(cart.id);
  assert.deepEqual(cleared.items, []);
  assert.equal(cleared.totalQuantity, 0);
  assert.equal(cleared.totalAmount, 0);
});

test('金额小计：多商品总价等于各项小计之和，浮点误差保留两位', () => {
  resetData();

  let cart = cartService.addItem(null, 'c01', 3);
  assert.equal(cart.items[0].subtotal, 89.7);

  cart = cartService.addItem(cart.id, 'c02', 1);
  assert.equal(cart.items.length, 2);
  assert.equal(cart.items[0].subtotal, 89.7);
  assert.equal(cart.items[1].subtotal, 100);
  assert.equal(cart.totalQuantity, 4);
  assert.equal(cart.totalAmount, 189.7);
});

test('getOrCreate：已有 id 复用原购物车，未知 id 新建而不是报错', () => {
  resetData();

  const first = cartService.getOrCreate(undefined).cart;
  const again = cartService.getOrCreate(first.id).cart;
  assert.equal(again.id, first.id);

  const unknown = cartService.getOrCreate('cart_not_exists');
  assert.notEqual(unknown.cart.id, first.id);
  assert.deepEqual(unknown.cart.items, []);
  assert.equal(store.read('carts', []).length, 2);
});

test('decorate：商品被删除后跳过该行，不影响其他商品结算', () => {
  resetData();

  store.write('carts', [{
    id: 'cart_dead',
    items: [
      { productId: 'c99', quantity: 2 },
      { productId: 'c01', quantity: 1 }
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }]);

  const cart = cartService.get('cart_dead');
  assert.deepEqual(cart.items.map((item) => item.productId), ['c01']);
  assert.equal(cart.totalQuantity, 1);
  assert.equal(cart.totalAmount, 29.9);
});
