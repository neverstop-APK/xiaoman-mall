/**
 * 【文件作用】购物车接口
 * ------------------------------------------------------------
 *   GET    /api/cart                        读取购物车
 *   POST   /api/cart/items                  加购 { cartId, productId, quantity }
 *   PATCH  /api/cart/items/:productId       改数量 { cartId, quantity }（0 = 删除）
 *   DELETE /api/cart/items/:productId?cartId=xxx  删除单项
 *   DELETE /api/cart?cartId=xxx             清空
 *
 * cartId 第一次由服务端生成并返回，前端存在 localStorage 里，
 * 之后每次请求都带上它，服务端就能找到同一个购物车。
 *
 * 【对应知识点】GET / POST / PATCH / DELETE 的区别、请求体、响应状态码
 * 【对应考核点】3.7 侧拉式购物车
 */
const cartService = require('../services/cart-购物车服务');
const { ok, HttpError } = require('../lib/response-统一响应格式');

module.exports = function registerCartRoutes({ add }) {
  add('GET', '/api/cart', ({ res, query }) => {
    ok(res, cartService.get(query.cartId));
  });

  add('POST', '/api/cart/items', ({ res, body }) => {
    if (!body.productId) throw new HttpError(400, 40021, '缺少 productId');
    ok(res, cartService.addItem(body.cartId, body.productId, body.quantity ?? 1));
  });

  add('PATCH', '/api/cart/items/:productId', ({ res, params, body }) => {
    ok(res, cartService.updateItem(body.cartId, params.productId, body.quantity));
  });

  add('DELETE', '/api/cart/items/:productId', ({ res, params, query, body }) => {
    const cartId = query.cartId || body.cartId;
    ok(res, cartService.removeItem(cartId, params.productId));
  });

  add('DELETE', '/api/cart', ({ res, query }) => {
    ok(res, cartService.clear(query.cartId));
  });
};
