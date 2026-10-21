/**
 * 【文件作用】订单接口
 * ------------------------------------------------------------
 *   POST /api/orders              创建订单 { cartId, receiver, remark }
 *   GET  /api/orders/:id          订单详情（结果页用它展示）
 *   POST /api/orders/:id/pay      模拟支付
 *   POST /api/orders/:id/cancel   取消订单（未支付时可取消）
 *
 * 【对应知识点】POST 与幂等、状态码 200 / 201 / 4xx
 * 【对应考核点】3.8 下单 + 模拟支付 + 结果页
 */
const orders = require('../services/orders-订单服务');
const { ok } = require('../lib/response-统一响应格式');

module.exports = function registerOrdersRoutes({ add }) {
  add('POST', '/api/orders', ({ res, body }) => {
    ok(res, orders.create(body), 201);
  });

  add('GET', '/api/orders/:id', ({ res, params }) => {
    ok(res, orders.getById(params.id));
  });

  add('POST', '/api/orders/:id/pay', ({ res, params }) => {
    ok(res, orders.pay(params.id));
  });

  add('POST', '/api/orders/:id/cancel', ({ res, params }) => {
    ok(res, orders.cancel(params.id));
  });
};
