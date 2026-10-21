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

const { handle } = require('./router-迷你路由');
const { serveStatic } = require('./lib/static-静态文件服务');

// 注册所有接口（每个文件导出一个注册函数）
require('./routes/products-商品接口')({ add: require('./router-迷你路由').add });
require('./routes/cart-购物车接口')({ add: require('./router-迷你路由').add });
require('./routes/orders-订单接口')({ add: require('./router-迷你路由').add });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();

  // 请求日志：一条请求一行，出问题时能看出是哪一步慢
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    console.log([req.method, req.url, res.statusCode, ms + 'ms'].join(' '));
  });

  // URL 解析：/api/products?keyword=耳机 -> pathname / searchParams
  const url = new URL(req.url, 'http://' + (req.headers.host || HOST + ':' + PORT));

  try {
    if (url.pathname.startsWith('/api/')) {
      await handle(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error('[服务器异常]', err);
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
  console.log('  数据目录： ' + path.join(__dirname, 'data'));
  console.log('  Ctrl + C 停止服务');
  console.log('');
});

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
