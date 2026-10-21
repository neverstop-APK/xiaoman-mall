/**
 * 【文件作用】Cookie 解析与登录态读取
 * ------------------------------------------------------------
 * 浏览器把 Cookie 放在请求头 cookie 里，格式是 "a=1; b=2"。
 * 服务端写 Cookie 用 Set-Cookie 响应头，关键属性：
 *   HttpOnly  禁止 JS 读取，降低 XSS 偷 token 的风险
 *   SameSite=Lax  跨站请求默认不带，降低 CSRF 风险
 *   Path=/    整个站点都有效
 *   Max-Age   有效期（秒）
 *
 * HTTP 本身是无状态的，所谓"登录态"就是：每次请求带着 Cookie，
 * 服务端用 Cookie 里的 token 查 sessions 表，找到用户。
 *
 * 【对应知识点】Cookie、HTTP 请求头/响应头、状态保持
 * 【对应考核点】八、登录状态管理
 */
const auth = require('../services/auth-用户认证服务');

const COOKIE_NAME = 'xm_session';

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const result = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

/** 从请求里读当前用户；没登录返回 null */
function currentUser(req) {
  const cookies = parseCookies(req);
  return auth.getUserByToken(cookies[COOKIE_NAME]);
}

function sessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || '';
}

/** 写登录 Cookie。生产环境走 HTTPS 时，isSecure 设为 true 更安全 */
function setSessionCookie(res, token, maxAgeSeconds, isSecure) {
  const parts = [
    COOKIE_NAME + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds
  ];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/** 反向代理后面判断是否 HTTPS，用来决定要不要加 Secure */
function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket && req.socket.encrypted);
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  currentUser,
  sessionToken,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest
};
