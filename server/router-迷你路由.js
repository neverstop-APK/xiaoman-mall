/**
 * 【文件作用】迷你路由：把 "请求方法 + 路径" 分发到对应的处理函数
 * ------------------------------------------------------------
 * Express 的写法是 app.get('/api/products/:id', handler)，
 * 这里不用任何第三方库，用正则把 :id 变成"能匹配任意值"的分组，原理完全一样。
 *
 * 每个处理函数收到的 ctx 包含：
 *   req / res        原始的请求和响应对象（http 模块给的）
 *   params           路径参数，如 /api/products/p01 -> { id: 'p01' }
 *   query            查询参数，如 ?keyword=耳机 -> { keyword: '耳机' }
 *   body             JSON 请求体（POST / PATCH 才有）
 *
 * 【对应知识点】Node.js http 模块、正则表达式、Promise（读请求体）
 * 【对应考核点】4.1 后端基础功能 —— 参数校验与错误处理
 */
const { HttpError, fail } = require('./lib/response-统一响应格式');

const routes = [];

/**
 * 注册一条路由
 * @param {string} method  GET / POST / PATCH / DELETE
 * @param {string} pattern '/api/products/:id'
 * @param {Function} handler
 */
function add(method, pattern, handler) {
  const keys = []; // 记住 :id 这种参数的名字
  const regex = new RegExp(
    '^' + pattern.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
      keys.push(key);
      return '([^/]+)';
    }) + '/?$'
  );
  routes.push({ method, regex, keys, handler });
}

/** 读取请求体。请求体是"流"，要一块一块收，收完再拼起来 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        // 1MB 上限：防止有人传超大文件把服务器内存撑爆
        reject(new HttpError(413, 41301, '请求体太大了'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 40000, '请求体不是合法的 JSON'));
      }
    });

    req.on('error', reject);
  });
}

/** 统一入口：找路由 -> 解析参数 -> 调用处理函数 -> 出错转 JSON */
async function handle(req, res, url) {
  // 允许跨域：方便以后把前端单独部署到别的域名
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cart-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');

  // 浏览器的预检请求，直接放行
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const pathname = url.pathname;
  const route = routes.find((r) => r.method === req.method && r.regex.test(pathname));
  if (!route) {
    return fail(res, 404, 40400, '接口不存在：' + req.method + ' ' + pathname);
  }

  // 把 /api/products/:id 里的 id 取出来
  const matched = pathname.match(route.regex);
  const params = {};
  route.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(matched[index + 1]);
  });

  const query = Object.fromEntries(url.searchParams.entries());

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      body = await readBody(req);
    } catch (err) {
      return fail(res, err.status || 400, err.code || 40000, err.message);
    }
  }

  try {
    await route.handler({ req, res, params, query, body });
  } catch (err) {
    if (res.writableEnded) return; // 已经在处理函数里响应过了
    if (err instanceof HttpError) return fail(res, err.status, err.code, err.message);
    console.error('[未处理的异常]', err);
    return fail(res, 500, 50000, '服务器开小差了：' + err.message);
  }
}

module.exports = { add, handle };
