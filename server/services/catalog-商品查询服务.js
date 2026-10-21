/**
 * 【文件作用】商品查询服务：搜索、筛选、排序、分页、取详情
 * ------------------------------------------------------------
 * 为什么单独抽一层"服务"？
 * 因为"查商品"这件事有两个调用方：
 *   1. HTTP 接口  GET /api/products
 *   2. 以后可能出现的其他调用方（比如 AI 工具）
 * 把逻辑写在接口里，第二个调用方就得复制一遍；写在服务里，两边共用。
 * 这就是"控制器只管收发请求，服务只管业务规则"的分层思想。
 *
 * 【对应知识点】数组方法 filter / sort / map / reduce、URL 查询参数
 * 【对应考核点】3.4 关键词搜索、3.5 分类与价格筛选、4.1 接口参数
 */
const store = require('../lib/store-JSON数据存储');
const { HttpError } = require('../lib/response-统一响应格式');

const SORT_RULES = {
  // value: [字段, 方向]   方向 1 升序，-1 降序
  'price-asc': ['price', 1],
  'price-desc': ['price', -1],
  'sales-desc': ['sales', -1],
  'rating-desc': ['rating', -1],
  'newest': ['createdAt', -1]
};

function allProducts() {
  return store.read('products', []);
}
function allCategories() {
  return store.read('categories', []);
}

/**
 * 把 URL 上的字符串参数变成数字，顺便做校验
 * 前端的输入永远不可信：minPrice=abc 不应该让服务器崩溃
 */
function toNumber(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '' || value === null) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new HttpError(400, 40011, fieldName + ' 必须是 ' + min + ' 到 ' + max + ' 之间的数字');
  }
  return num;
}

/**
 * 核心查询。
 * 返回 { list, total, page, pageSize, totalPages, filters, sort }，
 * 分页信息也一起返回，前端才能渲染"上一页 / 下一页"。
 */
function query(raw = {}) {
  const keyword = (raw.keyword || '').trim().toLowerCase();
  const category = (raw.category || '').trim();
  const minPrice = toNumber(raw.minPrice, 'minPrice');
  const maxPrice = toNumber(raw.maxPrice, 'maxPrice');
  const page = toNumber(raw.page, 'page', { min: 1 }) || 1;
  const pageSize = toNumber(raw.pageSize, 'pageSize', { min: 1, max: 60 }) || 12;
  const sort = SORT_RULES[raw.sort] ? raw.sort : 'default';

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new HttpError(400, 40012, '最低价不能高于最高价');
  }

  let list = allProducts();

  // 1. 关键词：名称 / 品牌 / 标签 / 关键词 任意命中
  if (keyword) {
    list = list.filter((item) => {
      const haystack = [item.name, item.brand, item.summary, ...(item.tags || []), ...(item.keywords || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }

  // 2. 分类
  if (category && category !== 'all') {
    list = list.filter((item) => item.category === category);
  }

  // 3. 价格区间
  if (minPrice !== undefined) list = list.filter((item) => item.price >= minPrice);
  if (maxPrice !== undefined) list = list.filter((item) => item.price <= maxPrice);

  // 4. 排序（先做一次浅拷贝，避免改到缓存里的原数组）
  if (sort !== 'default') {
    const [field, direction] = SORT_RULES[sort];
    list = [...list].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * direction);
  }

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paged = list.slice(start, start + pageSize);

  return {
    list: paged,
    total,
    page: safePage,
    pageSize,
    totalPages,
    filters: { keyword, category: category || 'all', minPrice: minPrice ?? null, maxPrice: maxPrice ?? null },
    sort
  };
}

/** 按 id 取单个商品，找不到抛 404 */
function getById(id) {
  const product = allProducts().find((item) => item.id === id);
  if (!product) throw new HttpError(404, 40401, '商品不存在或已下架：' + id);
  return product;
}

/** 首页分类入口：每个分类带上商品数量 */
function categories() {
  const products = allProducts();
  return allCategories().map((cat) => {
    const items = products.filter((item) => item.category === cat.key);
    return {
      ...cat,
      count: items.length,
      // count 是商品总数，available 是其中还有库存、能下单的数量
      available: items.filter((item) => item.stock > 0).length
    };
  });
}

/** 首页推荐位：按销量取前 N 个 */
function recommendations(limit = 4) {
  return [...allProducts()].sort((a, b) => b.sales - a.sales).slice(0, limit);
}

/** 详情页的"猜你喜欢"：同分类，排除自己 */
function related(id, limit = 4) {
  const current = getById(id);
  return allProducts()
    .filter((item) => item.category === current.category && item.id !== id)
    .slice(0, limit);
}

/** 给前端筛选面板用：所有出现过的价格区间参考值 */
function priceRange() {
  const prices = allProducts().map((item) => item.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

module.exports = { query, getById, categories, recommendations, related, priceRange, allProducts };
