/**
 * 【文件作用】用户认证服务：注册、登录、密码哈希、会话管理
 * ------------------------------------------------------------
 * 这里只用 Node 自带的 crypto，没有引入 bcrypt / jsonwebtoken。
 * 关键点：
 *   1. 密码绝不存明文，存的是 scrypt 哈希 + 每个用户独立的盐；
 *   2. 登录成功后生成一个随机 token，写进 HttpOnly Cookie，服务端 sessions 表里存 token 的 sha256；
 *   3. 每次请求由 lib/session-会话与Cookie.js 根据 Cookie 找到当前用户；
 *   4. 用户数据存 users-用户数据.json，会话存 sessions-用户会话.json。
 *
 * 【对应知识点】Node crypto、哈希与加盐、Cookie、HTTP 无状态
 * 【对应考核点】八、用户注册 / 登录 / 退出 / 登录状态管理
 */
const crypto = require('node:crypto');
const store = require('../lib/store-JSON数据存储');
const { HttpError } = require('../lib/response-统一响应格式');

const USERS = 'users';
const SESSIONS = 'sessions';
const SESSION_DAYS = 7;

/** 对外暴露的用户信息：一定要去掉 passwordHash 和 salt */
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, user) {
  const incoming = Buffer.from(hashPassword(password, user.salt), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (incoming.length !== stored.length) return false;
  // 用时间恒定的比较，避免通过响应时间猜密码
  return crypto.timingSafeEqual(incoming, stored);
}

function validateCredentials(username, password) {
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/.test(name)) {
    throw new HttpError(400, 40041, '用户名需 3–20 位，只能包含中英文、数字和下划线');
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 32) {
    throw new HttpError(400, 40042, '密码长度需为 6–32 位');
  }
  return name;
}

/** 注册：创建用户并直接返回登录态 */
function register({ username, password, nickname }) {
  const name = validateCredentials(username, password);
  const users = store.read(USERS, []);

  if (users.some((user) => user.username.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 40941, '这个用户名已经被注册了');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    username: name,
    nickname: String(nickname || name).trim().slice(0, 12),
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  users.push(user);
  store.write(USERS, users);
  return user;
}

/** 登录：校验密码并更新最后登录时间 */
function login({ username, password }) {
  const name = String(username || '').trim();
  const users = store.read(USERS, []);
  const user = users.find((item) => item.username.toLowerCase() === name.toLowerCase());

  // 不区分"用户不存在"和"密码错误"，避免被枚举用户名
  if (!user || !verifyPassword(String(password || ''), user)) {
    throw new HttpError(401, 40141, '用户名或密码不正确');
  }

  user.lastLoginAt = new Date().toISOString();
  store.write(USERS, users);
  return user;
}

/** 创建会话，返回可以直接写进 Cookie 的 token */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = store.read(SESSIONS, []);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  sessions.push({
    // 存哈希而不是 token 原文：数据库泄露也无法直接冒充登录
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt
  });

  // 顺手清理过期会话，避免文件越来越大
  const alive = sessions.filter((item) => item.expiresAt > Date.now());
  store.write(SESSIONS, alive);
  return { token, expiresAt };
}

/** 根据 token 找当前用户，过期或找不到返回 null */
function getUserByToken(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessions = store.read(SESSIONS, []);
  const session = sessions.find((item) => item.tokenHash === tokenHash);

  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    store.write(SESSIONS, sessions.filter((item) => item.tokenHash !== tokenHash));
    return null;
  }

  const user = store.read(USERS, []).find((item) => item.id === session.userId);
  return user || null;
}

function destroySession(token) {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessions = store.read(SESSIONS, []);
  store.write(SESSIONS, sessions.filter((item) => item.tokenHash !== tokenHash));
}

function getUserById(id) {
  return store.read(USERS, []).find((item) => item.id === id) || null;
}

module.exports = {
  publicUser,
  register,
  login,
  createSession,
  getUserByToken,
  destroySession,
  getUserById,
  SESSION_DAYS
};
