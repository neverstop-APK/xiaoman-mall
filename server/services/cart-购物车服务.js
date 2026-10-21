/**
 * 【文件作用】购物车服务：增删改查 + 金额计算
 * ------------------------------------------------------------
 * 设计上的两个关键决定（面试可以讲）：
 *
 * 1. 购物车存在服务端，前端只保存一个 cartId。
 *    好处：刷新页面、换浏览器标签，购物车都还在；
 *         价格和库存以服务端为准，前端改不了价格。
 *    代价：每次操作都要发请求，所以前端用"即时更新 UI + 请求失败再回滚"的方式保证手感。
 *
 * 2. 购物车里只存 { productId, quantity }，
 *    商品名、单价、库存都是"查询时现拼"的。
 *    好处：商品降价了，购物车里的价格自动跟着变，不会出现旧价格。
 *
 * 【对应知识点】数组 push / find / filter / reduce、对象引用
 * 【对应考核点】3.7 侧拉式购物车
 */
const crypto = require('node:crypto');
const store = require('../lib/store-JSON数据存储');
const { HttpError } = require('../lib/response-统一响应格式');

const MAX_QUANTITY = 99;

function loadCarts() {
  return store.read('carts', []);
}
function saveCarts(carts) {
  return store.write('carts', carts);
}

function newCartId() {
  return 'cart_' + crypto.randomBytes(6).toString('hex');
}

/** 取购物车，没有就新建一个 */
function getOrCreate(cartId) {
  const carts = loadCarts();
  let cart = cartId ? carts.find((item) => item.id === cartId) : null;
  if (cart) return { cart, carts };

  cart = { id: newCartId(), items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  carts.push(cart);
  saveCarts(carts);
  return { cart, carts };
}

/**
 * 把 { productId, quantity } 拼成前端要的完整结构，
 * 并在这一步顺便算好小计和总价。
 */
function decorate(cart) {
  const products = store.read('products', []);
  const items = cart.items
    .map((row) => {
      const product = products.find((item) => item.id === row.productId);
      if (!product) return null; // 商品被删了就跳过
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        emoji: product.emoji,
        cover: product.cover || '',
        category: product.category,
        stock: product.stock,
        quantity: row.quantity,
        subtotal: Number((product.price * row.quantity).toFixed(2)),
        soldOut: product.stock === 0
      };
    })
    .filter(Boolean);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));

  return { id: cart.id, items, totalQuantity, totalAmount };
}

function assertQuantity(quantity) {
  const num = Number(quantity);
  if (!Number.isInteger(num) || num < 1 || num > MAX_QUANTITY) {
    throw new HttpError(400, 40021, '数量必须是 1 到 ' + MAX_QUANTITY + ' 之间的整数');
  }
  return num;
}

/** 加入购物车：已存在就累加数量 */
function addItem(cartId, productId, quantity = 1) {
  const product = store.read('products', []).find((item) => item.id === productId);
  if (!product) throw new HttpError(404, 40401, '商品不存在：' + productId);
  if (product.stock <= 0) throw new HttpError(409, 40901, '「' + product.name + '」已售罄');

  const qty = assertQuantity(quantity);
  const { cart, carts } = getOrCreate(cartId);

  const row = cart.items.find((item) => item.productId === productId);
  const nextQuantity = (row ? row.quantity : 0) + qty;
  if (nextQuantity > product.stock) {
    throw new HttpError(409, 40902, '库存只剩 ' + product.stock + ' 件了');
  }

  if (row) row.quantity = nextQuantity;
  else cart.items.push({ productId, quantity: qty });

  cart.updatedAt = new Date().toISOString();
  saveCarts(carts);
  return decorate(cart);
}

/** 修改数量（数量传 0 等价于删除） */
function updateItem(cartId, productId, quantity) {
  const { cart, carts } = getOrCreate(cartId);
  const row = cart.items.find((item) => item.productId === productId);
  if (!row) throw new HttpError(404, 40402, '购物车里没有这件商品');

  if (Number(quantity) === 0) return removeItem(cartId, productId);

  const qty = assertQuantity(quantity);
  const product = store.read('products', []).find((item) => item.id === productId);
  if (product && qty > product.stock) {
    throw new HttpError(409, 40902, '库存只剩 ' + product.stock + ' 件了');
  }

  row.quantity = qty;
  cart.updatedAt = new Date().toISOString();
  saveCarts(carts);
  return decorate(cart);
}

function removeItem(cartId, productId) {
  const { cart, carts } = getOrCreate(cartId);
  cart.items = cart.items.filter((item) => item.productId !== productId);
  cart.updatedAt = new Date().toISOString();
  saveCarts(carts);
  return decorate(cart);
}

function clear(cartId) {
  const { cart, carts } = getOrCreate(cartId);
  cart.items = [];
  cart.updatedAt = new Date().toISOString();
  saveCarts(carts);
  return decorate(cart);
}

/** 下单成功后清空对应购物车 */
function clearById(cartId) {
  const carts = loadCarts();
  const cart = carts.find((item) => item.id === cartId);
  if (!cart) return;
  cart.items = [];
  cart.updatedAt = new Date().toISOString();
  saveCarts(carts);
}

function get(cartId) {
  const { cart } = getOrCreate(cartId);
  return decorate(cart);
}

module.exports = { get, getOrCreate, addItem, updateItem, removeItem, clear, clearById, decorate };
