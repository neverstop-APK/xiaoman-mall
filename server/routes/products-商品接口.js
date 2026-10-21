/**
 * 【文件作用】商品接口：把 HTTP 请求翻译成对"商品服务"的调用
 * ------------------------------------------------------------
 * 路由文件只做三件事：取参数 -> 调服务 -> 用统一格式返回。
 * 业务规则（怎么筛选、怎么排序）都在 services 里，这里保持很薄。
 *
 * 提供的接口：
 *   GET /api/products        列表（支持 keyword / category / minPrice / maxPrice / sort / page / pageSize）
 *   GET /api/products/:id    详情
 *   GET /api/products/:id/related  相关推荐
 *   GET /api/categories      分类 + 每个分类的商品数
 *   GET /api/recommendations 首页推荐
 *
 * 【对应知识点】URL 查询参数、RESTful 路径设计
 * 【对应考核点】4.1 商品接口
 */
const catalog = require('../services/catalog-商品查询服务');
const { ok } = require('../lib/response-统一响应格式');

module.exports = function registerProductsRoutes({ add }) {
  // 商品列表
  add('GET', '/api/products', ({ res, query }) => {
    ok(res, catalog.query(query));
  });

  // 分类列表。注意要放在 /api/products/:id 之前也不冲突，因为路径不同
  add('GET', '/api/categories', ({ res }) => {
    ok(res, catalog.categories());
  });

  // 首页推荐
  add('GET', '/api/recommendations', ({ res }) => {
    ok(res, catalog.recommendations(4));
  });

  // 商品详情
  add('GET', '/api/products/:id', ({ res, params }) => {
    ok(res, catalog.getById(params.id));
  });

  // 相关推荐
  add('GET', '/api/products/:id/related', ({ res, params }) => {
    ok(res, catalog.related(params.id, 4));
  });
};
