/**
 * 【文件作用】订单服务：校验库存、计算金额、生成订单号、模拟支付
 * ------------------------------------------------------------
 * 一条最重要的原则：金额一律以服务端计算为准。
 * 前端传来的 price、total 全部忽略，只接受商品 id 和数量。
 * 否则有人在浏览器控制台改一下价格，就能 1 块钱买走 699 的耳机。
 *
 * 订单号的组成（便于人工排查）：
 *   XM + 年月日 + 6 位随机大写字符，例如 XM20261021K7Q2M9
 *
 * 【对应知识点】Date、Math.random / crypto、数组 reduce、模板字符串
 * 【对应考核点】3.8 下单、模拟支付、结果页
 */
const crypto = require('node:crypto');
const store = require('../lib/store-JSON数据存储');
const cartService = require('./cart-购物车服务');
const { HttpError } = require('../lib/response-统一响应格式');

// 满 99 包邮，否则 12 元运费。运费规则写在这里，前端只负责展示
const FREE_SHIPPING_LIMIT = 99;
const SHIPPING_FEE = 12;

const STATUS_TEXT = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消'
};

function orderId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
  const rand = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  return 'XM' + date + rand;
}

function shippingFeeFor(goodsAmount) {
  return goodsAmount >= FREE_SHIPPING_LIMIT || goodsAmount === 0 ? 0 : SHIPPING_FEE;
}

/**
 * 创建订单
 * @param {object} body { cartId, items?, receiver?, remark?, paymentMethod? }
 */
function create(body = {}) {
  const products = store.read('products', []);

  // 1. 订单明细来源：优先用请求里的 items，否则读服务端购物车
  let source = Array.isArray(body.items) && body.items.length ? body.items : null;
  if (!source) {
    const cart = cartService.get(body.cartId);
    source = cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  }
  if (!source.length) throw new HttpError(400, 40031, '购物车是空的，没法下单');

  // 2. 逐条校验库存，并重新计算单价与小计
  const items = source.map((row) => {
    const product = products.find((item) => item.id === row.productId);
    if (!product) throw new HttpError(404, 40401, '商品不存在：' + row.productId);

    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(400, 40021, '「' + product.name + '」的数量不合法');
    }
    if (quantity > product.stock) {
      throw new HttpError(409, 40902, '「' + product.name + '」库存不足，只剩 ' + product.stock + ' 件');
    }
    return {
      productId: product.id,
      name: product.name,
      emoji: product.emoji,
      cover: product.cover || '',
      price: product.price,
      quantity,
      subtotal: Number((product.price * quantity).toFixed(2))
    };
  });

  // 3. 计算金额
  const goodsAmount = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
  const shippingFee = shippingFeeFor(goodsAmount);
  const totalAmount = Number((goodsAmount + shippingFee).toFixed(2));

  // 4. 组装订单
  const order = {
    id: orderId(),
    items,
    goodsAmount,
    shippingFee,
    totalAmount,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    status: 'pending',
    statusText: STATUS_TEXT.pending,
    paymentMethod: body.paymentMethod || 'mock',
    receiver: {
      name: (body.receiver && body.receiver.name) || '测试用户',
      phone: (body.receiver && body.receiver.phone) || '138****0000',
      address: (body.receiver && body.receiver.address) || '未填写收货地址'
    },
    remark: String(body.remark || '').slice(0, 100),
    cartId: body.cartId || null,
    createdAt: new Date().toISOString(),
    paidAt: null
  };

  // 5. 落盘：先写订单，再扣库存，最后清购物车
  const orders = store.read('orders', []);
  orders.unshift(order);
  store.write('orders', orders);

  const nextProducts = products.map((product) => {
    const hit = items.find((item) => item.productId === product.id);
    return hit ? { ...product, stock: product.stock - hit.quantity, sales: product.sales + hit.quantity } : product;
  });
  store.write('products', nextProducts);

  if (order.cartId) cartService.clearById(order.cartId);

  return order;
}

function getById(id) {
  const order = store.read('orders', []).find((item) => item.id === id);
  if (!order) throw new HttpError(404, 40403, '订单不存在：' + id);
  return order;
}

/** 模拟支付：真实项目这里是调微信/支付宝的支付接口 */
function pay(id) {
  const orders = store.read('orders', []);
  const order = orders.find((item) => item.id === id);
  if (!order) throw new HttpError(404, 40403, '订单不存在：' + id);
  if (order.status === 'paid') throw new HttpError(409, 40903, '这个订单已经付过款了');
  if (order.status === 'cancelled') throw new HttpError(409, 40904, '订单已取消，不能支付');

  order.status = 'paid';
  order.statusText = STATUS_TEXT.paid;
  order.paidAt = new Date().toISOString();
  store.write('orders', orders);
  return order;
}

function cancel(id) {
  const orders = store.read('orders', []);
  const order = orders.find((item) => item.id === id);
  if (!order) throw new HttpError(404, 40403, '订单不存在：' + id);
  if (order.status === 'paid') throw new HttpError(409, 40905, '已支付的订单不能取消');
  order.status = 'cancelled';
  order.statusText = STATUS_TEXT.cancelled;
  store.write('orders', orders);
  return order;
}

module.exports = { create, getById, pay, cancel, FREE_SHIPPING_LIMIT, SHIPPING_FEE, STATUS_TEXT };
