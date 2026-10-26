/**
 * 【文件作用】公共片段渲染：把页面里的 <!-- include: xxx --> 换成 public/partials 下的公共 HTML
 * ------------------------------------------------------------
 * 为什么需要它：
 *   购物车抽屉、结算弹窗、页脚在多个页面完全一样。复制粘贴会让它们慢慢长歪
 *   （例如某页少了运费提示），改一次要改五处。这里让服务端在返回 HTML 前拼一次。
 *
 * 约定：
 *   页面里写 <!-- include: footer -->，服务端只认下面 FILES 里登记过的名字，
 *   不接受任意路径，避免目录穿越，也不会把 public 之外的文件读进来。
 *
 * 缓存：
 *   按片段文件的 mtimeMs 缓存。片段改了，下一次请求会自动读到新内容；
 *   页面文件本身不用动。
 *
 * 【对应知识点】CommonJS、fs、path、正则替换、缓存
 */
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const PARTIAL_DIR = path.join(PUBLIC_DIR, 'partials');

// 只允许这些名字，页面里不能写任意路径
const FILES = {
  footer: 'footer-公共页脚.html',
  cartdrawer: 'cartdrawer-公共购物车.html',
  checkout: 'checkout-公共结算弹窗.html'
};

const INCLUDE_RE = /<!--\s*include:\s*([a-z0-9-]+)\s*-->/g;
const cache = new Map();

function readPartial(name) {
  // 用 hasOwnProperty 而不是直接 FILES[name]：避免 constructor、toString 这类原型属性被当成片段名
  if (!Object.prototype.hasOwnProperty.call(FILES, name)) {
    throw new Error('未知公共片段：' + name);
  }
  const fileName = FILES[name];

  const filePath = path.join(PARTIAL_DIR, fileName);
  const stat = fs.statSync(filePath);
  const hit = cache.get(name);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.html;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  cache.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, html });
  return html;
}

/**
 * 把页面 HTML 里的 include 标记替换成片段内容。
 * 只做一层替换：片段里不要再写 include，避免递归和死循环。
 */
function renderIncludes(html) {
  return html.replace(INCLUDE_RE, (_, name) => readPartial(name));
}

module.exports = { renderIncludes, FILES };
