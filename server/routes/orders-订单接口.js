/**
 * 【文件作用】订单接口
 * ------------------------------------------------------------
 *   POST /api/orders              创建订单 { cartId, receiver, remark }
 *   GET  /api/orders              当前登录用户的订单列表
 *   GET  /api/orders/:id          订单详情（结果页用它展示）
 *   POST /api/orders/:id/pay      模拟支付
 *   POST /api/orders/:id/cancel   取消订单（未支付时可取消，库存会退回）
 *
 * 权限规则：
 *   · 登录后下的订单带 userId，只有本人能看、能支付、能取消；
 *   · 未登录时的"游客订单"仍然凭订单号访问（演示用），登录后不会出现在列表里。
 *
 * 【对应知识点】HTTP 401 / 403、资源归属校验
 * 【对应考核点】3.8 下单 + 模拟支付 + 结果页；八、登录状态
 */
const orders = require('../services/orders-订单服务');
const { ok, HttpError } = require('../lib/response-统一响应格式');

function requireUser(user) {
  if (!user) throw new HttpError(401, 40102, '请先登录');
  return user;
}

/** 有归属的订单只能本人访问；游客订单（userId 为空）允许凭订单号访问 */
function assertAccess(order, user) {
  if (order.userId && (!user || user.id !== order.userId)) {
    throw new HttpError(403, 40301, '这笔订单属于其他账号，无法操作');
  }
  return order;
}

module.exports = function registerOrdersRoutes({ add }) {
  add('POST', '/api/orders', ({ res, body, user }) => {
    ok(res, orders.create({ ...body, userId: user ? user.id : null }), 201);
  });

  add('GET', '/api/orders', ({ res, user }) => {
    requireUser(user);
    ok(res, orders.listByUser(user.id));
  });

  add('GET', '/api/orders/:id', ({ res, params, user }) => {
    ok(res, assertAccess(orders.getById(params.id), user));
  });

  add('POST', '/api/orders/:id/pay', ({ res, params, user }) => {
    const order = assertAccess(orders.getById(params.id), user);
    ok(res, orders.pay(order.id));
  });

  add('POST', '/api/orders/:id/cancel', ({ res, params, user }) => {
    const order = assertAccess(orders.getById(params.id), user);
    ok(res, orders.cancel(order.id));
  });
};
