/**
 * 【文件作用】认证接口：注册、登录、退出、获取当前用户
 * ------------------------------------------------------------
 *   POST /api/auth/register   { username, password, nickname? }
 *   POST /api/auth/login      { username, password }
 *   POST /api/auth/logout     清除 Cookie 并删除服务端会话
 *   GET  /api/auth/me         返回当前登录用户，未登录返回 null
 *
 * 注册成功会直接创建会话并写 Cookie，用户不用再登录一次。
 *
 * 【对应知识点】Cookie、Set-Cookie、HTTP 401、注册与登录流程
 * 【对应考核点】八、注册 / 登录 / 退出 / 登录状态
 */
const auth = require('../services/auth-用户认证服务');
const session = require('../lib/session-会话与Cookie');
const { ok } = require('../lib/response-统一响应格式');

const COOKIE_MAX_AGE = auth.SESSION_DAYS * 24 * 60 * 60;

module.exports = function registerAuthRoutes({ add }) {
  add('POST', '/api/auth/register', ({ req, res, body }) => {
    const user = auth.register(body);
    const { token } = auth.createSession(user.id);
    session.setSessionCookie(res, token, COOKIE_MAX_AGE, session.isSecureRequest(req));
    ok(res, { user: auth.publicUser(user) }, 201);
  });

  add('POST', '/api/auth/login', ({ req, res, body }) => {
    const user = auth.login(body);
    const { token } = auth.createSession(user.id);
    session.setSessionCookie(res, token, COOKIE_MAX_AGE, session.isSecureRequest(req));
    ok(res, { user: auth.publicUser(user) });
  });

  add('POST', '/api/auth/logout', ({ req, res }) => {
    auth.destroySession(session.sessionToken(req));
    session.clearSessionCookie(res);
    ok(res, { loggedOut: true });
  });

  add('GET', '/api/auth/me', ({ req, res }) => {
    const user = session.currentUser(req);
    ok(res, { user: auth.publicUser(user) });
  });
};
