/**
 * Unit tests for server/services/auth-用户认证服务.js.
 * Covers register, duplicate username, login, wrong password, session token and expiry.
 * 【文件作用】用户认证服务的单元测试。
 * 【测什么】注册、重复用户名、用户名/密码校验、登录、错误密码、
 *           会话 token 只存哈希、注销失效、过期 token 自动清理、公开字段不泄露密码。
 * 【怎么跑】node --test tests/unit/auth-用户认证服务.test.mjs
 * 【注意】scrypt 哈希有计算成本，这个文件比其它单元测试稍慢，属于正常现象。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeTempDataDir, seedTables, removeTempDir } from '../测试辅助-临时数据目录.mjs';

const require = createRequire(import.meta.url);
const SERVER_DIR = fileURLToPath(new URL('../../server/', import.meta.url));

const dataDir = makeTempDataDir('xm-auth-');
seedTables(dataDir, { users: [], sessions: [] });

const store = require(path.join(SERVER_DIR, 'lib', 'store-JSON数据存储.js'));
const auth = require(path.join(SERVER_DIR, 'services', 'auth-用户认证服务.js'));

after(() => removeTempDir(dataDir));

/** 每个用例清空用户与会话 */
function resetData() {
  store.write('users', []);
  store.write('sessions', []);
}

function assertHttpError(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, 'HttpError');
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

test('register：创建用户，密码只保存 scrypt 哈希和随机盐', () => {
  resetData();

  const user = auth.register({ username: 'Test_User1', password: 'secret123', nickname: '小满' });

  assert.match(user.id, /^u_[0-9a-f]{12}$/);
  assert.equal(user.username, 'Test_User1');
  assert.equal(user.nickname, '小满');
  assert.match(user.salt, /^[0-9a-f]{32}$/);
  assert.match(user.passwordHash, /^[0-9a-f]{128}$/);
  assert.notEqual(user.passwordHash, 'secret123');
  assert.ok(Number.isFinite(Date.parse(user.createdAt)));
  assert.ok(Number.isFinite(Date.parse(user.lastLoginAt)));

  const saved = store.read('users', []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].passwordHash, user.passwordHash);
  assert.equal(saved[0].salt, user.salt);
});

test('register：用户名重复（不区分大小写）返回 409/40941', () => {
  resetData();

  auth.register({ username: 'Alice_01', password: 'secret123' });
  assertHttpError(() => auth.register({ username: 'alice_01', password: 'secret123' }), 409, 40941);
});

test('register：用户名或密码不合法返回 400/40041 或 400/40042', () => {
  resetData();

  assertHttpError(() => auth.register({ username: 'ab', password: 'secret123' }), 400, 40041);
  assertHttpError(() => auth.register({ username: 'a b c', password: 'secret123' }), 400, 40041);
  assertHttpError(() => auth.register({ username: 'a'.repeat(21), password: 'secret123' }), 400, 40041);

  assertHttpError(() => auth.register({ username: 'valid_name', password: '12345' }), 400, 40042);
  assertHttpError(() => auth.register({ username: 'valid_name', password: 'x'.repeat(33) }), 400, 40042);
  assertHttpError(() => auth.register({ username: 'valid_name', password: 12345678 }), 400, 40042);

  assert.deepEqual(store.read('users', []), []);
});

test('login：用户名不区分大小写，登录成功会刷新 lastLoginAt', () => {
  resetData();

  const user = auth.register({ username: 'Login_User', password: 'secret123' });
  const users = store.read('users', []);
  users[0].lastLoginAt = '2000-01-01T00:00:00.000Z';
  store.write('users', users);

  const logged = auth.login({ username: 'LOGIN_USER', password: 'secret123' });
  assert.equal(logged.id, user.id);
  assert.notEqual(logged.lastLoginAt, '2000-01-01T00:00:00.000Z');
  assert.ok(Date.parse(logged.lastLoginAt) > Date.parse('2000-01-01T00:00:00.000Z'));
  assert.equal(store.read('users', [])[0].lastLoginAt, logged.lastLoginAt);
});

test('login：密码错误和用户不存在都返回 401/40141，错误信息一致', () => {
  resetData();

  auth.register({ username: 'bob_01', password: 'secret123' });

  assertHttpError(() => auth.login({ username: 'bob_01', password: 'wrong-pass' }), 401, 40141);
  assertHttpError(() => auth.login({ username: 'nobody', password: 'secret123' }), 401, 40141);
});

test('createSession：token 为 64 位十六进制，sessions 表里只存 sha256 哈希', () => {
  resetData();

  const user = auth.register({ username: 'session_user', password: 'secret123' });
  const { token, expiresAt } = auth.createSession(user.id);

  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(expiresAt > Date.now());
  assert.ok(expiresAt <= Date.now() + auth.SESSION_DAYS * 24 * 60 * 60 * 1000);

  const sessions = store.read('sessions', []);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].userId, user.id);
  assert.notEqual(sessions[0].tokenHash, token);
  assert.equal(
    sessions[0].tokenHash,
    crypto.createHash('sha256').update(token).digest('hex')
  );

  const current = auth.getUserByToken(token);
  assert.equal(current.id, user.id);
  assert.equal(current.username, 'session_user');
});

test('destroySession：注销后 token 立即失效，空 token 不报错', () => {
  resetData();

  const user = auth.register({ username: 'logout_user', password: 'secret123' });
  const { token } = auth.createSession(user.id);

  auth.destroySession(token);
  assert.equal(auth.getUserByToken(token), null);
  assert.equal(store.read('sessions', []).length, 0);
  assert.doesNotThrow(() => auth.destroySession(''));
  assert.doesNotThrow(() => auth.destroySession(undefined));
});

test('getUserByToken：过期会话返回 null 并从表里清理，非法 token 返回 null', () => {
  resetData();

  const user = auth.register({ username: 'expired_user', password: 'secret123' });
  const token = crypto.randomBytes(32).toString('hex');
  store.write('sessions', [{
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    userId: user.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Date.now() - 1000
  }]);

  assert.equal(auth.getUserByToken(token), null);
  assert.equal(store.read('sessions', []).length, 0);

  assert.equal(auth.getUserByToken('not-a-real-token'), null);
  assert.equal(auth.getUserByToken(''), null);
  assert.equal(auth.getUserByToken(undefined), null);
});

test('publicUser / getUserById：查询用户可用，公开字段不包含密码与盐', () => {
  resetData();

  const user = auth.register({ username: 'public_user', password: 'secret123', nickname: '小满用户' });

  assert.equal(auth.getUserById(user.id).username, 'public_user');
  assert.equal(auth.getUserById('u_missing'), null);

  const pub = auth.publicUser(store.read('users', [])[0]);
  assert.equal(pub.id, user.id);
  assert.equal(pub.username, 'public_user');
  assert.equal(pub.nickname, '小满用户');
  assert.equal(pub.passwordHash, undefined);
  assert.equal(pub.salt, undefined);
  assert.deepEqual(Object.keys(pub).sort(), ['createdAt', 'id', 'lastLoginAt', 'nickname', 'username']);
  assert.equal(auth.publicUser(null), null);
});
