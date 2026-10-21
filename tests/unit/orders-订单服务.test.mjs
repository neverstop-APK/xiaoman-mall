/**
 * Unit tests for server/services/orders-订单服务.js.
 * Covers amount recalculation, free-shipping threshold, stock deduction,
 * cancel rollback, and duplicate pay / cancel errors.
 * 【文件作用】订单服务的单元测试。
 * 【测什么】下单按服务端价格重算金额、满 99 免运费否则 12 元、库存扣减、
 *           取消回滚库存与销量、重复支付/重复取消/已取消再支付等非法状态。
 * 【怎么跑】node --test tests/unit/orders-订单服务.test.mjs
 * 【数据】o01 49.9/库存10、o02 100/库存3、o03 99/库存5、o04 39/库存0（售罄）。
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
    id: 'o01', name: '测试耳塞', price: 49.9, stock: 10, sales: 5,
    category: '数码', emoji: '🎧', cover: '', summary: '测试用耳塞'
  },
  {
    id: 'o02', name: '测试台灯', price: 100, stock: 3, sales: 20,
    category: '家居', emoji: '💡', cover: '', summary: '测试用台灯'
  },
  {
    id: 'o03', name: '测试手账', price: 99, stock: 5, sales: 0,
    category: '文具', emoji: '📓', cover: '', summary: '测试用手账'
  },
  {
    id: 'o04', name: '测试袜子', price: 39, stock: 0, sales: 0,
    category: '服饰', emoji: '🧦', cover: '', summary: '已售罄的测试商品'
  }
];

const dataDir = makeTempDataDir('xm-orders-');
seedTables(dataDir, { products: PRODUCTS, orders: [], carts: [] });

const store = require(path.join(SERVER_DIR, 'lib', 'store-JSON数据存储.js'));
const cartService = require(path.join(SERVER_DIR, 'services', 'cart-购物车服务.js'));
const orders = require(path.join(SERVER_DIR, 'services', 'orders-订单服务.js'));

after(() => removeTempDir(dataDir));

/** 每个用例重置商品、订单、购物车三张表 */
function resetData() {
  store.write('products', structuredClone(PRODUCTS));
  store.write('orders', []);
  store.write('carts', []);
}

function findProduct(id) {
  return store.read('products', []).find((item) => item.id === id);
}

function assertHttpError(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, 'HttpError');
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

test('create：忽略请求里伪造的价格，按商品表现价重算金额', () => {
  resetData();

  const order = orders.create({
    items: [{ productId: 'o01', quantity: 2, price: 0.01, subtotal: 0.02 }],
    userId: 'u_test',
    receiver: { name: '测试用户', phone: '13800000000', address: '上海市测试路 1 号' }
  });

  assert.match(order.id, /^XM\d{8}[0-9A-F]{6}$/);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productId, 'o01');
  assert.equal(order.items[0].name, '测试耳塞');
  assert.equal(order.items[0].price, 49.9);
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[0].subtotal, 99.8);
  assert.equal(order.goodsAmount, 99.8);
  assert.equal(order.shippingFee, 0);
  assert.equal(order.totalAmount, 99.8);
  assert.equal(order.totalQuantity, 2);
  assert.equal(order.status, 'pending');
  assert.equal(order.statusText, '待支付');
  assert.equal(order.paidAt, null);
  assert.equal(order.userId, 'u_test');
  assert.equal(order.receiver.name, '测试用户');

  const saved = store.read('orders', []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, order.id);
});

test('create：满 99 免运费，不满 99 收 12 元运费', () => {
  resetData();

  const cheap = orders.create({ items: [{ productId: 'o01', quantity: 1 }] });
  assert.equal(cheap.goodsAmount, 49.9);
  assert.equal(cheap.shippingFee, 12);
  assert.equal(cheap.totalAmount, 61.9);

  const exact = orders.create({ items: [{ productId: 'o03', quantity: 1 }] });
  assert.equal(exact.goodsAmount, 99);
  assert.equal(exact.shippingFee, 0);
  assert.equal(exact.totalAmount, 99);
});

test('create：下单扣减库存并累加销量，库存不足抛 409/40902', () => {
  resetData();

  orders.create({ items: [{ productId: 'o02', quantity: 2 }] });
  assert.equal(findProduct('o02').stock, 1);
  assert.equal(findProduct('o02').sales, 22);
  // 其他商品不受影响
  assert.equal(findProduct('o01').stock, 10);
  assert.equal(findProduct('o01').sales, 5);

  assertHttpError(() => orders.create({ items: [{ productId: 'o02', quantity: 2 }] }), 409, 40902);
  assertHttpError(() => orders.create({ items: [{ productId: 'o04', quantity: 1 }] }), 409, 40902);
  // 失败的下单不能把库存扣掉
  assert.equal(findProduct('o02').stock, 1);
});

test('cancel：待支付订单可取消，库存与销量回滚', () => {
  resetData();

  const order = orders.create({ items: [{ productId: 'o01', quantity: 2 }], userId: 'u_1' });
  assert.equal(findProduct('o01').stock, 8);
  assert.equal(findProduct('o01').sales, 7);

  const cancelled = orders.cancel(order.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.statusText, '已取消');
  assert.ok(cancelled.cancelledAt);
  assert.equal(findProduct('o01').stock, 10);
  assert.equal(findProduct('o01').sales, 5);
  assert.equal(store.read('orders', []).find((item) => item.id === order.id).status, 'cancelled');
});

test('pay：支付成功后写入 paidAt，重复支付抛 409/40903，已支付不能取消', () => {
  resetData();

  const order = orders.create({ items: [{ productId: 'o01', quantity: 1 }] });
  const paid = orders.pay(order.id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.statusText, '已支付');
  assert.ok(paid.paidAt);
  assert.ok(Number.isFinite(Date.parse(paid.paidAt)));

  assertHttpError(() => orders.pay(order.id), 409, 40903);
  assertHttpError(() => orders.cancel(order.id), 409, 40905);
});

test('cancel：重复取消抛 409/40906，已取消订单再支付抛 409/40904', () => {
  resetData();

  const order = orders.create({ items: [{ productId: 'o01', quantity: 1 }] });
  orders.cancel(order.id);

  assertHttpError(() => orders.cancel(order.id), 409, 40906);
  assertHttpError(() => orders.pay(order.id), 409, 40904);
});

test('create：用购物车下单后金额正确，并清空对应购物车', () => {
  resetData();

  const cart = cartService.addItem(null, 'o01', 3);
  assert.equal(cart.totalAmount, 149.7);

  const order = orders.create({ cartId: cart.id });
  assert.equal(order.cartId, cart.id);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.goodsAmount, 149.7);
  assert.equal(order.shippingFee, 0);
  assert.equal(order.totalAmount, 149.7);

  const after = cartService.get(cart.id);
  assert.deepEqual(after.items, []);
  assert.equal(after.totalQuantity, 0);
});

test('create：空购物车、不存在商品、非法数量分别返回 400 / 404 / 400', () => {
  resetData();

  assertHttpError(() => orders.create({}), 400, 40031);
  assertHttpError(() => orders.create({ items: [] }), 400, 40031);
  assertHttpError(() => orders.create({ items: [{ productId: 'o99', quantity: 1 }] }), 404, 40401);
  assertHttpError(() => orders.create({ items: [{ productId: 'o01', quantity: 1.5 }] }), 400, 40021);
  assertHttpError(() => orders.create({ items: [{ productId: 'o01', quantity: 0 }] }), 400, 40021);
  assert.deepEqual(store.read('orders', []), []);
});

test('getById / listByUser：不存在抛 404/40403，按用户过滤且不含他人订单', () => {
  resetData();

  assertHttpError(() => orders.getById('XM00000000AAAAAA'), 404, 40403);

  const a1 = orders.create({ items: [{ productId: 'o01', quantity: 1 }], userId: 'u_a' });
  const a2 = orders.create({ items: [{ productId: 'o03', quantity: 1 }], userId: 'u_a' });
  const b1 = orders.create({ items: [{ productId: 'o01', quantity: 1 }], userId: 'u_b' });

  const listA = orders.listByUser('u_a');
  assert.equal(listA.length, 2);
  assert.deepEqual(new Set(listA.map((item) => item.id)), new Set([a1.id, a2.id]));
  assert.ok(listA.every((item) => item.userId === 'u_a'));

  assert.deepEqual(orders.listByUser('u_b').map((item) => item.id), [b1.id]);
  assert.deepEqual(orders.listByUser(null), []);
  assert.equal(orders.getById(a1.id).id, a1.id);
});
