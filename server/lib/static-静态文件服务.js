/**
 * 【文件作用】静态文件服务：把 public 目录里的页面/CSS/JS/图片发给浏览器
 * ------------------------------------------------------------
 * 浏览器请求 /css/base-设计变量与基础样式.css
 *   -> 服务器去 public/css/base-设计变量与基础样式.css 找文件
 *   -> 带上正确的 Content-Type 返回
 *
 * 安全要点：一定要把路径里的 ../ 处理掉，
 * 否则别人请求 /../../windows/system32/config 就能读到服务器上的任意文件，
 * 这叫"目录穿越漏洞"。
 *
 * 【对应知识点】Node.js http 模块、fs 模块、path 模块
 * 【对应考核点】3.2 首页、响应式（正确的 MIME 才能让 CSS/JS 生效）
 */
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// 首页和 404 页的文件名带中文说明，这里做一次映射
const DEFAULT_PAGE = '/index-首页.html';
const NOT_FOUND_PAGE = '/404-页面不存在.html';

// 浏览器靠 MIME 判断文件类型，类型给错 CSS 就不会生效
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  // 1. 默认文档：访问 / 时返回首页
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = DEFAULT_PAGE;

  // 2. 防止目录穿越：规范化之后必须仍然在 public 目录里面
  const safeRel = path.normalize(rel).replace(/^[/\\]+/, '');
  const filePath = path.join(PUBLIC_DIR, safeRel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 禁止访问');
  }

  // 3. 文件不存在 -> 友好的 404 页面
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const notFound = path.join(PUBLIC_DIR, NOT_FOUND_PAGE);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : '404 Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);

  // 4. 304 缓存：浏览器带了 If-Modified-Since，且文件没变过，就直接说"没变"
  const since = req.headers['if-modified-since'];
  if (since && new Date(since).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000) {
    res.writeHead(304);
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    // 开发阶段 HTML 不缓存，改完刷新就能看到
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
  });
  fs.createReadStream(filePath).pipe(res);
}

module.exports = { serveStatic, PUBLIC_DIR };
