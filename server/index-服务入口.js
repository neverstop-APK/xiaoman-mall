/**
 * 【文件作用】服务入口：创建 HTTP 服务，把请求分给接口或静态文件
 * ------------------------------------------------------------
 * 这是整个后端的起点，用 node server/index-服务入口.js 启动。
 * 只用 Node 内置模块，不需要 npm install。
 *
 * 一次请求的完整过程（面试常问）：
 *   1. 浏览器发起请求 -> createServer 的回调被触发
 *   2. 用 new URL() 解析出路径和查询参数
 *   3. 路径以 /api/ 开头 -> 交给 router 处理业务
 *      否则 -> 交给 static 返回 public 里的页面/样式/图片
 *   4. 处理完写响应，浏览器拿到内容开始渲染
 *
 * 【对应知识点】Node.js http 模块、URL、端口号、模块化
 * 【对应考核点】四、后端要求
 */
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const pkg = require('../package.json');

const { handle } = require('./router-迷你路由');
const { serveStatic } = require('./lib/static-静态文件服务');

// 注册所有接口（每个文件导出一个注册函数）
require('./routes/auth-认证接口')({ add: require('./router-迷你路由').add });
require('./routes/products-商品接口')({ add: require('./router-迷你路由').add });
require('./routes/cart-购物车接口')({ add: require('./router-迷你路由').add });
require('./routes/orders-订单接口')({ add: require('./router-迷你路由').add });
require('./routes/agent-购物助手接口')({ add: require('./router-迷你路由').add });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const startedAt = Date.now();

const server = http.createServer(async (req, res) => {
  const requestStart = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  // 每个请求都带一个 id：日志、浏览器 Network、错误上报能对上同一条
  res.setHeader('X-Request-Id', requestId);
  // 基础安全响应头：禁止被 iframe 嵌套、禁止猜 MIME、少给一点浏览器能力
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // 请求日志：一条请求一行，出问题时能看出是哪一步慢
  res.on('finish', () => {
    const ms = Date.now() - requestStart;
    console.log([requestId, req.method, req.url, res.statusCode, ms + 'ms'].join(' '));
  });

  // URL 解析：/api/products?keyword=耳机 -> pathname / searchParams
  const url = new URL(req.url, 'http://' + (req.headers.host || HOST + ':' + PORT));

  try {
    // 健康检查给负载均衡/监控用，不经过业务路由，也不读数据文件
    if (url.pathname === '/api/health') {
      const body = JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          status: 'ok',
          version: pkg.version,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          // 和 agent.mode() 保持一致：没有 Key 时即使写了 AGENT_MODE=llm，也实际运行本地规则
    mode: process.env.AGENT_MODE === 'local' || !process.env.AGENT_API_KEY ? 'local' : 'llm',
          now: new Date().toISOString()
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }

    if (url.pathname.startsWith('/api/')) {
      await handle(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error('[' + requestId + '] 服务器异常', err);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 服务器内部错误');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  小满商城 已启动');
  console.log('  本地访问： http://' + HOST + ':' + PORT + '/');
  console.log('  数据目录： ' + (process.env.XM_DATA_DIR || path.join(__dirname, 'data')));
  console.log('  Ctrl + C 停止服务');
  console.log('');
});

/**
 * 优雅退出：先停止接新请求，等在途请求结束再退出。
 * 部署到服务器后 systemctl restart 会发 SIGTERM，否则正在写 JSON 的请求可能被拦腰截断。
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('收到 ' + signal + '，正在停止服务…');
  server.close(() => {
    console.log('服务已停止');
    process.exit(0);
  });
  // 兜底：5 秒还没断干净就强制退出，避免 systemd 一直卡在 stopping
  setTimeout(() => {
    console.error('仍有连接未结束，强制退出');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 端口被占用时给一句人话提示，而不是一堆英文报错
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。可以换一个端口启动：');
    console.error('  set PORT=3001 && node server/index-服务入口.js');
  } else {
    console.error('服务启动失败：', err);
  }
  process.exit(1);
});
