/**
 * 【文件作用】本地规则引擎：没有大模型时也能把对话跑通
 * ------------------------------------------------------------
 * 为什么要有它？
 *   1. 考核现场不一定有网、有 API Key，助手不能因此变成摆设；
 *   2. 它是"标准答案"：意图怎么识别、参数怎么补全、工具怎么串起来，
 *      这些逻辑本来就该由代码保证，而不是全交给模型；
 *   3. 评测时可以拿它和大模型对比，说明"模型到底多做了什么"。
 *
 * 它不是"假装智能"：搜索、加购、下单确认走的都是真实工具和真实接口，
 * 只是"听懂人话"这一步用正则和关键词代替了模型。
 *
 * 【对应知识点】正则表达式、字符串处理、状态机式意图识别、async/await
 * 【对应考核点】9.1 对话、9.3 多轮约束、9.5 多步规划、9.6 歧义与拒答
 */
const catalog = require('../services/catalog-商品查询服务');
const tools = require('./tools-工具集');

const SLEEP = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const INJECTION_RE =
  /(忽略|无视|忘记|跳过).{0,8}(之前|以上|前面|所有|你的|系统)?.{0,6}(指令|规则|提示|设定)|system\s*prompt|开发者模式|你现在是|从现在起你|扮演|越狱|jailbreak|api[\s_-]?key|密钥|数据库密码|管理员密码/i;

const OUT_OF_SCOPE_RE =
  /天气|新闻|股票|基金|比特币|彩票|写代码|写个程序|翻译|讲个笑话|唱歌|写诗|电影|政治|医疗|诊断|法律咨询|投资建议|机票|火车票|酒店|航班|景点|旅游|打车|外卖/i;

const CHECKOUT_RE = /(结算|下单|提交订单|去支付|结账|买下来|付款)/;
const CART_VIEW_RE = /(购物车|车里).{0,6}(有什么|看看|多少|内容|情况)|查看购物车|购物车里/;
const ORDER_RE = /(订单|单号|物流|发货|到哪了|买了什么)/;
const ADD_RE = /(加入|加进|加到|放进|放进|扔进|来一个|来一件|买|要了|拿下)/;
const REMOVE_RE = /(删除|删掉|去掉|不要了|移除)/;
const COMPARE_RE = /(对比|比较|区别|哪个好|选哪个|差多少)/;
const CHEAPER_RE = /(便宜|低价|实惠|省钱|再低)/;
const EXPENSIVE_RE = /(贵一点|贵点|更好|升级|高档)/;
const RECOMMEND_RE = /(推荐|有什么|买什么|选什么|适合|介绍)/;
const GREETING_RE = /^(你好|您好|hi|hello|嗨|在吗|早上好|下午好|晚上好)[!！。.\s]*$/i;
const THANKS_RE = /(谢谢|多谢|辛苦|感谢)/;
const HELP_RE = /(能做什么|会什么|怎么用|帮助|使用说明|你是谁)/;
const DETAIL_RE = /(卖点|亮点|详情|参数|规格|怎么样|好用吗|值得买|介绍一下|介绍下)/;
const PRICE_ASK_RE = /(多少钱|价格|售价|几块|贵不贵)/;
const FEATURE_WORDS = ['降噪', '无线', '运动', '通勤', '机械', '静音', 'HiFi', '有线', '便携', '陶瓷', '羊毛', '纯棉', '防水'];

const FILLER_RE =
  /(帮我|请|麻烦|我想|想|我要|要|先|再|然后|接着|顺便|找|搜|看看|看一下|推荐|一些|一点|有点|比较|一个|一件|个|件|的|吗|呢|吧|啊|呀|嘛|有没有|有|什么|适合|给我|在|里|元|块|钱|预算|不超过|最多|最少|以内|以下|之内|左右|上下|块钱|越贵越好|越便宜越好|贵一点|便宜一点)/g;

const ORDINALS = [
  { re: /(第|no\.?)?\s*(1|一)\s*(个|件|款)?/i, index: 0 },
  { re: /(第|no\.?)?\s*(2|二|两)\s*(个|件|款)?/i, index: 1 },
  { re: /(第|no\.?)?\s*(3|三)\s*(个|件|款)?/i, index: 2 },
  { re: /(第|no\.?)?\s*(4|四)\s*(个|件|款)?/i, index: 3 }
];

function money(value) {
  const num = Number(value || 0);
  return '¥' + (Number.isInteger(num) ? num : num.toFixed(2));
}

function cleanText(message) {
  return String(message || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function keywordOf(message) {
  return message
    .replace(/(\d+(?:\.\d+)?)\s*(元|块)?\s*(以内|以下|之内|左右|上下|起)/g, ' ')
    .replace(/(不超过|最多|预算|低于|高于|大于|小于)\s*\d+(?:\.\d+)?/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:-|~|到|至)\s*\d+(?:\.\d+)?\s*(?:元|块)?/g, ' ')
    .replace(/(最便宜|最低价|最贵|最高档)/g, ' ')
    .replace(/分类/g, ' ')
    .replace(FILLER_RE, ' ')
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()【】\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析价格条件：X 以内 / 不超过 X / X-Y / X 左右 */
function parsePrice(message) {
  message = String(message || '');
  const range = message.match(/(\d+(?:\.\d+)?)\s*(?:-|~|到|至)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/);
  if (range) return { minPrice: Number(range[1]), maxPrice: Number(range[2]) };

  const under = message.match(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:以内|以下|之内|内|封顶)/);
  if (under) return { maxPrice: Number(under[1]) };

  const notOver = message.match(/(?:不超过|最多|预算|低于|小于)\s*(\d+(?:\.\d+)?)/);
  if (notOver) return { maxPrice: Number(notOver[1]) };

  const around = message.match(/(\d+(?:\.\d+)?)\s*(?:元|块)\s*(?:左右|上下)/);
  if (around) {
    const price = Number(around[1]);
    return { minPrice: Math.floor(price * 0.7), maxPrice: Math.ceil(price * 1.2) };
  }
  return {};
}

function findOrdinal(message) {
  // 只认“第一个/第二个/第 2 个”，避免把“300 元”里的 3 当成第三个
  const explicit = message.match(/第\s*([1-4一二两三四])\s*(?:个|件|款|条)/);
  if (!explicit) return -1;
  const table = { 1: 0, 一: 0, 2: 1, 二: 1, 两: 1, 3: 2, 三: 2, 4: 3, 四: 3 };
  return table[explicit[1]] ?? -1;
}

/** 在商品库里找用户可能指的那一件：先看序号，再看名称/标签命中 */
function resolveProduct(message, conversation, { allowSearch = true } = {}) {
  const lastIds = (conversation.memory && conversation.memory.lastProducts) || [];
  const ordinal = findOrdinal(message);
  if (ordinal >= 0) {
    const id = lastIds[ordinal];
    if (id) {
      try {
        return catalog.getById(id);
      } catch {
        return null;
      }
    }
  }

  if (/(这个|这件|这款|它|刚才那个|刚刚那个|第一个)/.test(message) && lastIds[0]) {
    try {
      return catalog.getById(lastIds[0]);
    } catch {
      /* 继续往后找 */
    }
  }

  const lower = message.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const product of catalog.allProducts()) {
    let score = 0;
    if (lower.includes(product.name.toLowerCase())) score += 8;
    if (product.brand && lower.includes(String(product.brand).toLowerCase())) score += 2;
    for (const word of product.keywords || []) {
      if (word && word.length >= 2 && lower.includes(String(word).toLowerCase())) score += 3;
    }
    for (const tag of product.tags || []) {
      if (tag && tag.length >= 2 && lower.includes(String(tag).toLowerCase())) score += 2;
    }
    // 拉丁字母型号，例如 Studio / Air One / K87
    for (const token of String(product.name).match(/[A-Za-z][A-Za-z0-9 ]{1,12}/g) || []) {
      if (lower.includes(token.trim().toLowerCase())) score += 3;
    }
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  if (best) return best;

  if (allowSearch) {
    const keyword = keywordOf(message);
    if (keyword) {
      const found = catalog.query({ keyword, pageSize: 8 });
      if (found.total === 1) return found.list[0];
      if (found.total > 1 && lastIds.length) {
        const inLast = found.list.find((item) => lastIds.includes(item.id));
        if (inLast) return inLast;
      }
    }
  }
  return null;
}

function formatList(items, { limit = 5 } = {}) {
  return items
    .slice(0, limit)
    .map((item, index) => index + 1 + '. ' + item.name + ' ' + money(item.price) + '（' + (item.tags || []).slice(0, 2).join(' / ') + '，库存 ' + item.stock + '）')
    .join('\n');
}

/** 一个查询里带了好几个词时，挑覆盖面最大的那个当核心词（“通勤 耳机” -> “耳机”） */
function pickCoreKeyword(keyword) {
  const tokens = String(keyword || '').split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length < 2) return '';
  let best = '';
  let bestTotal = -1;
  for (const token of tokens) {
    try {
      const result = catalog.query({ keyword: token, pageSize: 1 });
      if (result.total > bestTotal) {
        bestTotal = result.total;
        best = token;
      }
    } catch (error) {
      /* 单个词查不动就跳过 */
    }
  }
  return best;
}

/** 关键词里带着品类别名时（“通勤耳机”“机械键盘”），取最长的那个当核心词 */
function coreFromAliases(keyword) {
  const aliases = {
    数码: ['耳机', '键盘', '音箱', '充电', '数码'],
    家居: ['杯子', '马克杯', '香薰', '台灯', '陶瓷'],
    文具: ['笔记本', '本子', '手账', '文具'],
    户外: ['背包', '水壶', '野餐', '露营', '户外'],
    服饰: ['外套', '袜子', '围巾', '服饰'],
    配件: ['耳机套', '腕托', '桌垫', '贴纸', '配件']
  };
  let best = '';
  for (const words of Object.values(aliases)) {
    for (const word of words) {
      if (keyword.includes(word) && word.length > best.length) best = word;
    }
  }
  return best === keyword ? '' : best;
}

function searchAndReply({ message, conversation, emit, user }, extra = {}) {
  const parsed = parsePrice(message);
  const price = { ...parsed, ...extra.price };
  const category = tools.resolveCategory(message.replace(/分类/g, '')) || conversation.memory.lastCategory || '';
  let keyword = keywordOf(message).slice(0, 20);
  if (category && keyword.includes(category)) {
    keyword = keyword.replace(category, '').replace(/分类/g, '').trim();
  }
  // “降噪耳机”“机械键盘”这类词，真正能缩小范围的是修饰词，先按修饰词搜
  const feature = FEATURE_WORDS.find((word) => message.toLowerCase().includes(word.toLowerCase()));
  if (feature) keyword = feature;

  const args = {
    keyword,
    category: category || undefined,
    minPrice: price.minPrice,
    maxPrice: price.maxPrice,
    sort: extra.sort || (/(最便宜|最低价)/.test(message) ? 'price-asc' : /(最贵|最高档|越贵)/.test(message) ? 'price-desc' : 'default'),
    limit: 6
  };

  let result = tools.execute('search_products', args, { conversation, user });
  if (!result.ok) return { text: '搜索没成功：' + result.error.message, products: [] };

  // 多个词严格匹配可能只剩一件（“通勤 耳机”“通勤耳机”），放宽到核心词再试一次，结果更多才采用
  if (result.data.total <= 1) {
    const core = keyword.includes(' ') ? pickCoreKeyword(keyword) : coreFromAliases(keyword);
    if (core && core !== keyword) {
      const retry = tools.execute(
        'search_products',
        { ...args, keyword: core, category: args.category || tools.resolveCategory(core) || undefined },
        { conversation, user }
      );
      if (retry.ok && retry.data.total > result.data.total) {
        result = retry;
        args.keyword = core;
        args.category = args.category || tools.resolveCategory(core) || undefined;
      }
    }
  }

  const items = result.data.items;
  if (!items.length) {
    const hint = price.maxPrice ? '把预算放宽一点，或者换个关键词' : '换个关键词，或者告诉我预算范围';
    return { text: '没找到符合条件的商品。可以' + hint + '，比如“300 元以内的耳机”。', products: [] };
  }

  emit('products', items);

  const conditions = [];
  if (args.keyword) conditions.push('「' + args.keyword + '」');
  if (args.category) {
    const cat = catalog.categories().find((item) => item.key === args.category);
    if (cat) conditions.push('分类「' + (cat.label || cat.name || cat.key) + '」');
  }
  if (args.minPrice && args.maxPrice) {
    conditions.push('价格 ' + money(args.minPrice) + '–' + money(args.maxPrice));
  } else if (args.maxPrice) {
    conditions.push(money(args.maxPrice) + ' 以内');
  } else if (args.minPrice) {
    conditions.push(money(args.minPrice) + ' 以上');
  }
  if (args.sort === 'price-desc') conditions.push('价格从高到低');
  if (args.sort === 'price-asc') conditions.push('价格从低到高');
  const head = '按' + (conditions.length ? conditions.join('、') : '全部商品') + '找到 ' + result.data.total + ' 件';
  const tail = result.data.total > items.length ? '，先给你看前 ' + items.length + ' 件' : '';
  const nextHint =
    items.length > 1
      ? '编号在卡片左上角，直接点“加入购物车”就行；也可以说“把第 2 件加购”，或者“再便宜一点”。'
      : '就这一件，直接点“加入购物车”就行；想换换也可以说“再便宜一点”或“再贵一点”。';
  return {
    text: head + tail + '。' + nextHint,
    products: items
  };
}

function cheaperReply({ conversation, emit, user }) {
  const lastIds = conversation.memory.lastProducts || [];
  if (!lastIds.length) return { text: '先告诉我想找什么，我才能帮你比价。比如“300 元以内的耳机”。', products: [] };

  // “便宜一点”参照的是上一轮列表里的第一件（最相关的那件），
  // 而不是“列表里最便宜的配件”，否则 299 元的耳机旁边 29 元的耳机套会把预算带偏。
  let reference = null;
  try {
    reference = catalog.getById(lastIds[0]);
  } catch {
    reference = null;
  }
  if (!reference) return { text: '上一轮的商品已经找不到了，重新搜一次吧。', products: [] };

  const floor = reference.price;
  if (floor <= 1) return { text: '已经是最低价了，没有更便宜的同类商品。', products: [] };
  const maxPrice = floor - 1;
  const lastQuery = conversation.memory.lastQuery || {};
  // 上一轮没有分类时，沿用参照商品的分类，避免把“耳机”降级成“耳机套”
  const category = lastQuery.category || reference.category;
  const result = tools.execute(
    'search_products',
    { keyword: lastQuery.keyword, category, maxPrice, limit: 6 },
    { conversation, user }
  );
  if (!result.ok) return { text: '比价失败：' + result.error.message, products: [] };
  const items = result.data.items;
  if (!items.length) {
    // 只查一下当前最低价用于说明，不能走 tools.execute：那会改写“上一轮商品”，让“第一个”失去指代
    let lowest = null;
    try {
      lowest = catalog.query({ keyword: lastQuery.keyword, category, sort: 'price-asc', pageSize: 1 }).list[0] || null;
    } catch (error) {
      lowest = null;
    }
    return {
      text:
        '「' + (lastQuery.keyword || '这个分类') + '」里比 ' + money(floor) + ' 更便宜的暂时没有了' +
        (lowest && lowest.price >= floor ? '，现在最低就是 ' + money(lowest.price) : '') +
        '。要不要把预算放宽一点，或者换个分类看看？',
      products: []
    };
  }
  emit('products', items);
  return {
    text: '上一轮第一件是 ' + money(floor) + '，把上限压到 ' + money(maxPrice) + ' 后又找到 ' + items.length + ' 件，编号在下面。这次要哪一件？',
    products: items
  };
}

function expensiveReply({ conversation, emit, user }) {
  const lastIds = conversation.memory.lastProducts || [];
  const prices = lastIds
    .map((id) => {
      try {
        return catalog.getById(id).price;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!prices.length) return { text: '先搜一轮商品，我才能帮你往上比。', products: [] };
  const ceil = Math.max(...prices);
  const lastQuery = conversation.memory.lastQuery || {};
  const first = lastIds.map((id) => { try { return catalog.getById(id); } catch { return null; } }).find(Boolean);
  const result = tools.execute('search_products', { keyword: lastQuery.keyword, category: lastQuery.category || (first && first.category), minPrice: ceil + 1, sort: 'price-asc', limit: 6 }, { conversation, user });
  if (!result.ok || !result.data.items.length) {
    return { text: '比 ' + money(ceil) + ' 更贵的同类商品暂时没有。要不要看看别的分类？', products: [] };
  }
  emit('products', result.data.items);
  return { text: '比上一轮最贵的 ' + money(ceil) + ' 更高的有 ' + result.data.items.length + ' 件，编号在下面。要看看哪一件的详情？', products: result.data.items };
}

function detailReply({ product, conversation, emit, user }) {
  const result = tools.execute('get_product', { productId: product.id }, { conversation, user });
  if (!result.ok) return { text: result.error.message, products: [] };
  const detail = result.data.detail || {};
  const points = (detail.sellingPoints || []).slice(0, 4).map((point) => '· ' + point).join('\n');
  emit('products', [tools.toCard(result.data.product)]);
  return {
    text:
      '「' + result.data.product.name + '」现在 ' + money(result.data.product.price) + '，库存 ' + result.data.product.stock + ' 件。\n' +
      (points ? '卖点：\n' + points + '\n' : '') +
      (detail.description ? detail.description : '') +
      '\n要加入购物车，直接说“把这个加进购物车”。',
    products: [tools.toCard(result.data.product)]
  };
}

function addReply({ message, conversation, emit, user }) {
  const product = resolveProduct(message, conversation);
  if (!product) {
    return { text: '要加入哪一件？可以说商品名，或者说“第一个/第二个”指上一轮列表里的商品。', products: [] };
  }
  const quantityMatch = message.match(/(?:×|x|X|\*)?\s*(\d+)\s*(?:个|件|台|只|份)/);
  const quantity = quantityMatch ? Math.min(Math.max(Number(quantityMatch[1]), 1), 99) : 1;
  const result = tools.execute('add_to_cart', { productId: product.id, quantity }, { conversation, user });
  if (!result.ok) return { text: '没加进去：' + result.error.message, products: [] };
  emit('cart', result.data.cart);
  return {
    text:
      '已经把「' + product.name + '」加入购物车（×' + quantity + '）。现在购物车 ' + result.data.cart.totalQuantity + ' 件，合计 ' + money(result.data.cart.totalAmount) + '。\n要结算的话说“下单”，想改数量直接说“第二个改成 2 件”。',
    // 不返回单件商品卡：多步指令里“搜索 -> 加购”会用它覆盖掉前面的搜索结果
    products: []
  };
}

function cartViewReply({ conversation, emit, user }) {
  const result = tools.execute('view_cart', {}, { conversation, user });
  if (!result.ok) return { text: '购物车读取失败：' + result.error.message };
  const cart = result.data.cart;
  if (!cart.items.length) return { text: '购物车还是空的。告诉我你想找什么，我先帮你挑。' };
  emit('cart', cart);
  return {
    text:
      '购物车里有 ' + cart.totalQuantity + ' 件：\n' +
      cart.items.map((item) => '· ' + item.name + ' ×' + item.quantity + '，小计 ' + money(item.subtotal)).join('\n') +
      '\n合计 ' + money(cart.totalAmount) + '。要改数量就说“把 XX 改成 2 件”，要结算就说“下单”。'
  };
}

function checkoutReply({ conversation, emit, user }) {
  const result = tools.execute('create_order', {}, { conversation, user });
  if (!result.ok) return { text: result.error.message };
  const action = result.data.pendingAction;
  emit('action', action);
  return {
    text:
      '购物车 ' + action.quantity + ' 件，商品金额 ' + money(action.amount) + '。\n收货信息确认一下：点下面的“填写并确认下单”，填好姓名、手机号、地址再提交。确认之前我不会创建订单，金额也会由服务端重新算一遍。'
  };
}

function orderReply({ message, conversation, emit, user }) {
  if (!user) return { text: '查订单需要先登录，点右上角“登录 / 注册”，登录后我就能帮你查最近订单。' };
  const orderIdMatch = message.toUpperCase().match(/XM\d{8}[A-F0-9]{6}/);
  if (orderIdMatch) {
    const result = tools.execute('get_order', { orderId: orderIdMatch[0] }, { conversation, user });
    if (!result.ok) return { text: result.error.message };
    const order = result.data.order;
    return {
      text:
        '订单 ' + order.id + '：' + order.statusText + '，实付 ' + money(order.total) + '。\n' +
        order.items.map((item) => '· ' + item.name + ' ×' + item.quantity + ' ' + money(item.price)).join('\n') +
        '\n收货人 ' + order.receiver.name + '，下单时间 ' + new Date(order.createdAt).toLocaleString('zh-CN') + '。'
    };
  }
  const result = tools.execute('list_my_orders', {}, { conversation, user });
  if (!result.ok) return { text: result.error.message };
  const orders = result.data.orders;
  if (!orders.length) return { text: '你还没有订单。挑好商品后说“下单”，我带你走一遍结算。' };
  return {
    text:
      '最近 ' + orders.length + ' 笔订单：\n' +
      orders.map((order) => '· ' + order.id + '  ' + order.statusText + '  ' + money(order.total) + '  ' + new Date(order.createdAt).toLocaleDateString('zh-CN')).join('\n') +
      '\n想看某一笔的明细，把订单号发给我。'
  };
}

function compareReply({ message, conversation, emit, user }) {
  const lastIds = conversation.memory.lastProducts || [];
  let pair = [];
  if (/前两个|这两个|这两个|两款/.test(message) && lastIds.length >= 2) {
    pair = lastIds.slice(0, 2).map((id) => catalog.getById(id));
  } else {
    const mentioned = catalog
      .allProducts()
      .filter((product) => message.toLowerCase().includes(product.name.toLowerCase()) || (product.keywords || []).some((word) => word.length >= 2 && message.includes(word)));
    pair = mentioned.slice(0, 2);
  }
  if (pair.length < 2) return { text: '告诉我具体比哪两件，比如“对比 Air One 和 Studio”，或者先搜一轮再说“对比前两个”。' };

  const [a, b] = pair;
  const diff = Math.abs(a.price - b.price);
  const cheaper = a.price <= b.price ? a : b;
  return {
    text:
      '「' + a.name + '」' + money(a.price) + ' vs 「' + b.name + '」' + money(b.price) + '\n' +
      '· 差价 ' + money(diff) + '，便宜的是「' + cheaper.name + '」\n' +
      '· ' + a.name + '：' + (a.summary || '') + '\n' +
      '· ' + b.name + '：' + (b.summary || '') + '\n' +
      '如果更看重预算，选 ' + cheaper.name + '；要更强的功能，就看另一件。要我把其中一件加进购物车吗？',
    products: [tools.toCard(a), tools.toCard(b)]
  };
}

function updateQuantityReply({ message, conversation, emit, user }) {
  const product = resolveProduct(message, conversation, { allowSearch: false });
  if (!product) return { text: '要改哪一件的数量？说商品名，或者说“把第一个改成 2 件”。' };
  const qty = message.match(/(?:改成|改为|变成|调整成|数量(?:改|设)?成?)\s*(\d+)/) || message.match(/(\d+)\s*(?:个|件|台|份)/);
  if (!qty) return { text: '「' + product.name + '」要改成几件？' };
  const quantity = Math.min(Math.max(Number(qty[1]), 0), 99);
  const result = tools.execute('update_cart_quantity', { productId: product.id, quantity }, { conversation, user });
  if (!result.ok) return { text: '数量没改成：' + result.error.message };
  emit('cart', result.data.cart);
  return {
    text:
      (quantity === 0 ? '已删除「' + product.name + '」。' : '已把「' + product.name + '」改成 ' + quantity + ' 件。') +
      '购物车现在 ' + result.data.cart.totalQuantity + ' 件，合计 ' + money(result.data.cart.totalAmount) + '。'
  };
}

function removeReply({ message, conversation, emit, user }) {
  const product = resolveProduct(message, conversation, { allowSearch: false });
  if (!product) return { text: '要删哪一件？说商品名，或者说“删除第一个”。' };
  const result = tools.execute('update_cart_quantity', { productId: product.id, quantity: 0 }, { conversation, user });
  if (!result.ok) return { text: '删除失败：' + result.error.message };
  emit('cart', result.data.cart);
  return { text: '已从购物车删除「' + product.name + '」。现在还剩 ' + result.data.cart.totalQuantity + ' 件，合计 ' + money(result.data.cart.totalAmount) + '。' };
}

async function handleSegment(segment, ctx) {
  const { conversation, emit, user } = ctx;
  const message = segment.trim();
  if (!message) return { text: '', products: [] };

  if (INJECTION_RE.test(message)) {
    return {
      text: '这条消息看起来想改我的规则或套取密钥，这个我不会做。我只在这个商城里帮你找商品、加购物车、查订单。'
    };
  }
  if (OUT_OF_SCOPE_RE.test(message)) {
    return { text: '这个超出小满商城的范围了。我能做的是：找商品、按价格/分类筛选、加购物车、结算下单、查订单。' };
  }
  if (HELP_RE.test(message)) {
    return {
      text:
        '我是小满商城的购物助手，能帮你：\n' +
        '· 找商品：“300 元以内的耳机”“家居分类有什么”\n' +
        '· 比价：“再便宜一点”“对比前两个”\n' +
        '· 加购与改数量：“把第二个加入购物车”“第一个改成 2 件”\n' +
        '· 结算：“下单”，我会先让你确认收货信息\n' +
        '· 查订单：“我的订单”，登录后可用\n' +
        '写操作都会先问你，不会偷偷下单。'
    };
  }
  if (GREETING_RE.test(message)) {
    return { text: '你好，我是小满的购物助手。想找点什么？可以说“300 元以内的耳机”，或者“推荐几件家居好物”。' };
  }
  if (THANKS_RE.test(message) && message.length <= 12) {
    return { text: '不客气。还要继续挑，或者去结算，随时叫我。' };
  }

  const under = message.match(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:以内|以下|之内)/);
  const over = message.match(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:以上|起)/);
  if (under && over && Number(over[1]) > Number(under[1])) {
    return {
      text:
        '这两个价格条件冲突：一个要求不超过 ' + money(Number(under[1])) + '，一个要求不低于 ' + money(Number(over[1])) +
        '，同一件商品没法同时满足。你想保留哪一个？'
    };
  }

  if (DETAIL_RE.test(message) || PRICE_ASK_RE.test(message)) {
    const product = resolveProduct(message, conversation, { allowSearch: false });
    if (product) return detailReply({ product, conversation, emit, user });
  }

  if (ORDER_RE.test(message)) return orderReply({ message, conversation, emit, user });
  if (CHECKOUT_RE.test(message)) return checkoutReply({ conversation, emit, user });
  if (COMPARE_RE.test(message)) return compareReply({ message, conversation, emit, user });
  if (REMOVE_RE.test(message)) return removeReply({ message, conversation, emit, user });
  if (/(改成|改为|变成|调整成)/.test(message)) return updateQuantityReply({ message, conversation, emit, user });
  if (CART_VIEW_RE.test(message)) return cartViewReply({ conversation, emit, user });
  if (CHEAPER_RE.test(message) && /(再|还|更|一点|点)/.test(message)) return cheaperReply({ conversation, emit, user });
  if (EXPENSIVE_RE.test(message) && /(再|还|更|一点|点)/.test(message)) return expensiveReply({ conversation, emit, user });

  // 只有“把 X 加入购物车 / 加入购物车 / 买这个”才算明确的加购意图；
  // “我想买耳机”是在逛，交给搜索，不然会把搜索结果第一件直接塞进购物车。
  const strongAdd =
    /(加入购物车|加进购物车|放进购物车|加到购物车)/.test(message) ||
    /(把|将).{0,12}(加入|放进|加进|加到)/.test(message) ||
    /(买|要)(这个|这件|这款|它)/.test(message);
  if (strongAdd) return addReply({ message, conversation, emit, user });

  if (ADD_RE.test(message) && /(我想|想|帮我).{0,6}(买|要)/.test(message)) {
    return searchAndReply({ ...ctx, message });
  }

  if (/(最便宜|最低价)/.test(message)) {
    return searchAndReply({ ...ctx, message }, { sort: 'price-asc' });
  }

  // 只说“推荐一下”但没给品类或预算，先反问一句，避免把 26 件商品一股脑倒出来
  const vague = /^(推荐|随便|看看|有什么|买点什么|挑一|帮我挑|不知道买)/.test(message);
  const hasPrice = Boolean(parsePrice(message).maxPrice || parsePrice(message).minPrice);
  if (vague && !hasPrice && !tools.resolveCategory(message)) {
    return {
      text:
        '可以，先告诉我两个信息我好挑：想买哪一类（耳机 / 键盘 / 杯子 / 外套…），预算大概多少？\n' +
        '例如：“500 元以内的键盘”“通勤用的耳机，800 以内”。'
    };
  }

  if (RECOMMEND_RE.test(message) || parsePrice(message).maxPrice || tools.resolveCategory(message) || keywordOf(message)) {
    return searchAndReply({ ...ctx, message });
  }

  return {
    text:
      '没太听懂这句。可以试试：\n' +
      '· “300 元以内的耳机”\n' +
      '· “把第二个加入购物车”\n' +
      '· “再便宜一点”\n' +
      '· “我的订单”'
  };
}

/** 把一句话拆成多个动作：“找耳机，然后把第一个加进购物车” */
function splitSegments(message) {
  return message
    .split(/(?:然后|接着|顺便|之后再|,\s*再|，\s*再)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);
}

async function run({ conversation, message, emit, user }) {
  const text = cleanText(message);
  if (!text) return { reply: '你想找点什么？可以直接说商品或预算。', products: [], cart: null, action: null };

  const segments = splitSegments(text);
  const replies = [];
  let products = [];
  let cart = null;
  let action = null;

  const capture = (type, payload) => {
    if (type === 'cart') cart = payload;
    if (type === 'action') action = payload;
    emit(type, payload);
  };

  for (const segment of segments) {
    const result = await handleSegment(segment, { conversation, emit: capture, user });
    if (result.text) replies.push(result.text);
    if (result.products && result.products.length) products = result.products;
  }

  const reply = replies.join('\n\n') || '你想找点什么？';
  // 按句号/换行切成小块推给前端，模拟流式输出的观感
  const chunks = reply.match(/[^\n。！？]+[。！？\n]?/g) || [reply];
  for (const chunk of chunks) {
    emit('delta', { text: chunk });
    await SLEEP(12);
  }

  return { reply, products, cart, action };
}

module.exports = { run, analyze: handleSegment, resolveProduct, parsePrice, keywordOf, money };
