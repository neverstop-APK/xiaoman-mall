/**
 * 【文件作用】Agent 工具集：助手能"动手"做的每一件事
 * ------------------------------------------------------------
 * 工具（tool）就是一段有名字、有参数说明、有返回值的普通函数。
 * 大模型不能直接改数据库，它只能输出"我要调用 search_products，参数是 {...}"，
 * 由我们这边的代码真正执行，再把结果喂回给模型。这一层就是"模型的手"。
 *
 * 为什么工具要单独一个文件？
 *   1. 本地规则引擎和真正的大模型共用同一套工具，切换模型不影响业务；
 *   2. 每个工具都复用 services，不重写查询/购物车/订单逻辑；
 *   3. 评测时可以直接调工具，不必经过模型，方便定位是"模型不会用工具"还是"工具本身有 bug"。
 *
 * 【安全边界】
 *   · 只读工具（搜商品、看购物车、查订单）可以直接执行；
 *   · 写操作 create_order 不直接下单，只生成一条 pending 动作，等用户在前端点确认；
 *   · 金额永远由服务端 orders 服务重新计算，模型说的价格不算数。
 *
 * 【对应知识点】函数封装、参数校验、JSON Schema、错误处理
 * 【对应考核点】9.2 工具调用、9.4 写操作确认、9.6 异常处理
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const catalog = require('../services/catalog-商品查询服务');
const cartService = require('../services/cart-购物车服务');
const orderService = require('../services/orders-订单服务');

/** 给模型看的工具说明书（OpenAI function calling 格式） */
const DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        '按关键词、分类、价格区间搜索商品，返回最多 8 件商品的简要信息。用户想找东西、问有什么、要推荐时都用它。价格单位是元。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '商品关键词，例如 耳机、键盘、杯子；没有就省略' },
          category: {
            type: 'string',
            description: '分类 key：digital 数码、home 家居、stationery 文具、outdoor 户外、clothing 服饰、accessory 配件'
          },
          minPrice: { type: 'number', description: '最低价（含）' },
          maxPrice: { type: 'number', description: '最高价（含）' },
          sort: {
            type: 'string',
            enum: ['default', 'price-asc', 'price-desc', 'sales-desc', 'rating-desc', 'newest'],
            description: '排序方式，用户说“最便宜”用 price-asc，“最受欢迎”用 sales-desc'
          },
          limit: { type: 'number', description: '返回数量，默认 6，最多 8' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_product',
      description: '查看某一件商品的完整信息：价格、库存、规格、介绍、卖点。用户追问某件商品细节时使用。',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string', description: '商品 id，例如 p02' } },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'view_cart',
      description: '查看当前购物车：有哪些商品、数量、单项小计、总件数和总金额。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_to_cart',
      description: '把商品加入购物车。用户明确说“加入购物车/买这个/来一个”时使用，数量默认 1。',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: '商品 id' },
          quantity: { type: 'number', description: '数量，1–99，默认 1' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_cart_quantity',
      description: '修改购物车里某件商品的数量；数量为 0 表示删除。',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          quantity: { type: 'number', description: '新数量，0–99' }
        },
        required: ['productId', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_my_orders',
      description: '查看当前登录用户的订单列表。用户问“我的订单/买了什么/到哪了”时使用；未登录会返回错误。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_order',
      description: '按订单号查询一笔订单的详情与状态。',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string', description: '形如 XM20261021ABCDEF' } },
        required: ['orderId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        '为当前购物车创建订单，但不会立刻扣款：会生成一个待确认动作返回给用户，用户在前端填写收货信息并点“确认下单”后才真正创建。提交订单、结算、下单时使用。',
      parameters: {
        type: 'object',
        properties: {
          receiverName: { type: 'string', description: '收货人姓名，用户没说就留空，前端会让他补' },
          remark: { type: 'string', description: '订单备注，可省略' }
        }
      }
    }
  }
];

// key 必须和 categories-商品分类.json 里的 key 一致（中文），否则永远匹配不到
const CATEGORY_ALIASES = {
  数码: ['数码', '电子', '耳机', '键盘', '音箱', '充电', '数码产品'],
  家居: ['家居', '家', '杯子', '杯', '香薰', '台灯', '桌', '厨房', '陶瓷'],
  文具: ['文具', '本子', '笔记本', '笔', '书写', '手账'],
  户外: ['户外', '出门', '背包', '水壶', '野餐', '露营'],
  服饰: ['服饰', '衣服', '穿', '外套', '袜子', '帽', '围巾'],
  配件: ['配件', '小东西', '挂件', '贴纸', '耳机套', '腕托', '桌垫']
};

function categoryKeys() {
  return catalog.categories().map((item) => item.key);
}

/** 把“数码”“耳机”这类中文说法归一成分类 key，识别不了就返回空 */
function resolveCategory(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const keys = categoryKeys();
  if (keys.includes(value)) return value;
  const byLabel = catalog.categories().find((item) => item.label === value || item.name === value);
  if (byLabel) return byLabel.key;
  // 取“命中的最长词”，否则“耳机套”会先命中数码的“耳机”
  let bestKey = '';
  let bestLength = 0;
  for (const key of keys) {
    for (const word of CATEGORY_ALIASES[key] || []) {
      if (word.length > bestLength && value.includes(word)) {
        bestKey = key;
        bestLength = word.length;
      }
    }
  }
  return bestKey;
}

/** 只把前端画卡片需要的字段给出去，避免把整条数据都塞进上下文 */
function toCard(product) {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    price: product.price,
    originalPrice: product.originalPrice || null,
    emoji: product.emoji,
    cover: product.cover || '',
    summary: product.summary,
    tags: (product.tags || []).slice(0, 3),
    stock: product.stock,
    rating: product.rating
  };
}

function ok(data, summary) {
  return { ok: true, data, summary };
}
function bad(message, code = 'TOOL_ERROR') {
  return { ok: false, error: { code, message } };
}

function asInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function searchProducts(args = {}, ctx = {}) {
  const limit = Math.min(Math.max(asInt(args.limit, 6), 1), 8);
  const query = {
    keyword: String(args.keyword || '').trim().slice(0, 30),
    category: resolveCategory(args.category) || undefined,
    minPrice: args.minPrice === undefined || args.minPrice === null || args.minPrice === '' ? undefined : args.minPrice,
    maxPrice: args.maxPrice === undefined || args.maxPrice === null || args.maxPrice === '' ? undefined : args.maxPrice,
    sort: args.sort || 'default',
    page: 1,
    pageSize: limit
  };

  let result;
  try {
    result = catalog.query(query);
  } catch (err) {
    return bad(err.message || '搜索条件不合法', 'BAD_FILTER');
  }

  const items = result.list.map(toCard);
  if (ctx.conversation) {
    ctx.conversation.memory = {
      ...ctx.conversation.memory,
      lastQuery: {
        keyword: query.keyword,
        category: query.category || '',
        minPrice: query.minPrice ?? null,
        maxPrice: query.maxPrice ?? null,
        sort: query.sort
      },
      // 搜索为空时保留上一轮结果，否则用户说“把第一个加入购物车”就失去了指代对象
      lastProducts: items.length ? items.map((item) => item.id) : ctx.conversation.memory.lastProducts || [],
      lastCategory: query.category || ''
    };
  }

  const conditions = [];
  if (query.keyword) conditions.push('关键词“' + query.keyword + '”');
  if (query.category) {
    const cat = catalog.categories().find((item) => item.key === query.category);
    conditions.push('分类“' + (cat ? cat.name : query.category) + '”');
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    conditions.push('价格 ' + (query.minPrice ?? 0) + '–' + (query.maxPrice ?? '不限') + ' 元');
  }

  const summary =
    '搜索' + (conditions.length ? conditions.join('、') : '全部商品') + '：共 ' + result.total + ' 件，返回 ' + items.length + ' 件' +
    (items.length ? '（' + items.map((item) => item.name + ' ¥' + item.price).join('；') + '）' : '');

  return ok({ items, total: result.total, filters: query }, summary);
}

function getProduct(args = {}) {
  try {
    const product = catalog.getById(String(args.productId || '').trim());
    return ok({ product: toCard(product), detail: { description: product.description, sellingPoints: product.sellingPoints, specs: product.specs, sales: product.sales } }, '查看商品：' + product.name + ' ¥' + product.price + '，库存 ' + product.stock);
  } catch (err) {
    return bad(err.message || '商品不存在', 'NOT_FOUND');
  }
}

function ensureCartId(ctx) {
  const cart = cartService.get(ctx.conversation.cartId || '');
  ctx.conversation.cartId = cart.id; // 未知 id 时服务端会新建，把新 id 记下来
  return cart;
}

function cartSnapshot(cart) {
  return {
    id: cart.id,
    totalQuantity: cart.totalQuantity,
    totalAmount: cart.totalAmount,
    items: cart.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.subtotal,
      // 下面这些字段是给前端抽屉直接复用购物车渲染准备的，缺一个就会掉图
      emoji: item.emoji,
      cover: item.cover,
      category: item.category,
      stock: item.stock,
      soldOut: item.soldOut
    }))
  };
}

function viewCart(_args, ctx) {
  const cart = ensureCartId(ctx);
  return ok({ cart: cartSnapshot(cart) }, '购物车 ' + cart.totalQuantity + ' 件，合计 ¥' + cart.totalAmount);
}

function addToCart(args = {}, ctx) {
  try {
    const cart = cartService.addItem(ctx.conversation.cartId || '', String(args.productId || '').trim(), asInt(args.quantity, 1));
    ctx.conversation.cartId = cart.id;
    const added = cart.items.find((item) => item.productId === args.productId);
    return ok(
      { cart: cartSnapshot(cart), added: added ? { productId: added.productId, name: added.name, quantity: added.quantity } : null },
      '已加入购物车：' + (added ? added.name + ' ×' + added.quantity : args.productId) + '；购物车共 ' + cart.totalQuantity + ' 件，合计 ¥' + cart.totalAmount
    );
  } catch (err) {
    return bad(err.message || '加入购物车失败', 'CART_ERROR');
  }
}

function updateCartQuantity(args = {}, ctx) {
  try {
    const cart = cartService.updateItem(ctx.conversation.cartId || '', String(args.productId || '').trim(), asInt(args.quantity, 1));
    ctx.conversation.cartId = cart.id;
    return ok({ cart: cartSnapshot(cart) }, '购物车已更新：共 ' + cart.totalQuantity + ' 件，合计 ¥' + cart.totalAmount);
  } catch (err) {
    return bad(err.message || '修改数量失败', 'CART_ERROR');
  }
}

function listMyOrders(_args, ctx) {
  if (!ctx.user) return bad('用户还没有登录，无法查看订单。可以请用户先登录。', 'NOT_LOGIN');
  const list = orderService.listByUser(ctx.user.id).slice(0, 5);
  return ok(
    { orders: list.map((order) => ({ id: order.id, status: order.status, statusText: order.statusText, total: order.totalAmount, createdAt: order.createdAt, items: order.items.map((item) => item.name + '×' + item.quantity) })) },
    list.length ? '最近订单 ' + list.length + ' 笔：' + list.map((order) => order.id + '（' + order.statusText + ' ¥' + order.totalAmount + '）').join('；') : '还没有订单'
  );
}

function getOrder(args = {}, ctx) {
  const id = String(args.orderId || '').trim().toUpperCase();
  try {
    const order = orderService.getById(id);
    if (ctx.user && order.userId && order.userId !== ctx.user.id) {
      return bad('这笔订单不属于当前账号', 'FORBIDDEN');
    }
    return ok(
      { order: { id: order.id, status: order.status, statusText: order.statusText, total: order.totalAmount, receiver: order.receiver, items: order.items, createdAt: order.createdAt } },
      '订单 ' + order.id + '：' + order.statusText + '，实付 ¥' + order.totalAmount
    );
  } catch (err) {
    return bad(err.message || '订单不存在', 'NOT_FOUND');
  }
}

let actionSeq = 0;
function createOrder(args = {}, ctx) {
  const conversation = ctx.conversation;
  const cart = ensureCartId(ctx);
  if (!cart.items.length) return bad('购物车是空的，先挑一件商品再加进来吧', 'EMPTY_CART');

  const receiverName = String(args.receiverName || '').trim().slice(0, 20) || '';
  const remark = String(args.remark || '').trim().slice(0, 60);
  actionSeq += 1;
  const actionId = 'act_' + Date.now().toString(36) + actionSeq;

  const action = {
    id: actionId,
    type: 'create_order',
    status: 'pending',
    args: { cartId: cart.id, remark, receiverName },
    amount: cart.totalAmount,
    quantity: cart.totalQuantity,
    items: cart.items.map((item) => ({ productId: item.productId, name: item.name, price: item.price, quantity: item.quantity, subtotal: item.subtotal })),
    createdAt: new Date().toISOString()
  };
  conversation.pending[actionId] = action;

  return ok(
    { pendingAction: action },
    '已生成待确认订单：' + cart.totalQuantity + ' 件，商品金额 ¥' + cart.totalAmount + '，等待用户确认收货信息后才会真正下单'
  );
}

// 用 AsyncLocalStorage 收集本轮的工具调用，写 Trace 时用。
// 好处：不用把 trace 参数一层层传进每个工具，也不会在并发请求之间串数据。
const traceStore = new AsyncLocalStorage();

function withTrace(list, fn) {
  return traceStore.run(list, fn);
}

const HANDLERS = {
  search_products: searchProducts,
  get_product: getProduct,
  view_cart: viewCart,
  add_to_cart: addToCart,
  update_cart_quantity: updateCartQuantity,
  list_my_orders: listMyOrders,
  get_order: getOrder,
  create_order: createOrder
};

/**
 * 执行一个工具。
 * 永远不抛异常：失败也返回 { ok:false, error }，
 * 这样模型能看到"为什么失败"并换一种方式重试，而不是整个对话中断。
 */
function execute(name, args, ctx) {
  const startedAt = Date.now();
  const record = (result) => {
    const list = traceStore.getStore();
    if (Array.isArray(list)) {
      list.push({
        name,
        args: args || {},
        ok: result.ok,
        summary: result.ok ? result.summary : result.error && result.error.message,
        ms: Date.now() - startedAt
      });
    }
    return result;
  };

  const handler = HANDLERS[name];
  if (!handler) return record({ ok: false, error: { code: 'UNKNOWN_TOOL', message: '没有这个工具：' + name } });
  try {
    return record(handler(args || {}, ctx));
  } catch (err) {
    return record({ ok: false, error: { code: 'TOOL_CRASH', message: err.message || '工具执行失败' } });
  }
}

module.exports = { DEFINITIONS, execute, resolveCategory, toCard, CATEGORY_ALIASES, withTrace };
