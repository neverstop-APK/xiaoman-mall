/**
 * API integration tests — spawn the real server on port 3210 with an isolated XM_DATA_DIR.
 * 【文件作用】接口集成测试：启动真实后端进程，用 fetch 走完整 HTTP 链路。
 * ------------------------------------------------------------
 * 为什么不用 supertest / 直接调路由？
 *   接口测试的价值在于验证"进程真的能启动、端口真的能连、Cookie 真的能来回、
 *   SSE 真的按事件流吐出来"。直接调函数会漏掉启动参数、静态路由、会话这些坑。
 *
 * 测试环境：
 *   · 端口固定 3210（任务要求），启动前先探测，占用时给出明确报错；
 *   · XM_DATA_DIR 指向 mkdtemp 临时目录，只复制真实的商品/分类数据，
 *     购物车、订单、用户、会话都从空表开始；
 *   · XM_TRACE_FILE 也放进临时目录，否则助手会写进 server/data；
 *   · AGENT_MODE=local，不依赖网络和 API Key。
 *
 * 清理：
 *   after 里先 SIGTERM（Windows 上会直接结束进程），3 秒不退再 taskkill，
 *   最后递归删除临时目录。端口和目录都释放，重复跑不会互相干扰。
 *
 * 【覆盖点】商品列表/搜索/筛选、购物车增删改、下单/支付/取消、
 *   注册登录 Cookie、未登录 401、他人订单 403、助手 local 模式搜索 + 确认下单。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { copySeedTable, delay, makeTempDataDir, removeTempDir } from '../测试辅助-临时数据目录.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED_DIR = path.join(ROOT, 'server', 'data');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index-服务入口.js');
const PORT = 3210;
const BASE = 'http://127.0.0.1:' + PORT;
const PASSWORD = 'Passw0rd!';
const STAMP = Date.now().toString(36);

let dataDir = '';
let traceFile = '';
let child = null;
let serverLog = '';
let spawnError = null;

/** 启动前先确认端口没被别的进程（包括上一次跑残留的服务）占着 */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      reject(new Error('端口 ' + port + ' 无法监听（可能已被占用）：' + err.message));
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve());
    });
  });
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error('后端进程启动失败：' + spawnError.message);
    if (child.exitCode !== null) {
      throw new Error('后端进程提前退出，exitCode=' + child.exitCode + '\n' + serverLog);
    }
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) {
        const json = await res.json();
        if (json.code === 0 && json.data && json.data.status === 'ok') return json.data;
      }
    } catch (err) {
      lastError = err;
    }
    await delay(100);
  }
  throw new Error('等待后端就绪超时（' + timeoutMs + 'ms）：' + (lastError ? lastError.message : '无响应') + '\n' + serverLog);
}

/** 统一的请求封装：返回状态码、JSON 包体和原始文本，方便断言错误信息 */
async function request(method, pathname, { body, cookie, headers } = {}) {
  const options = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (cookie) options.headers.Cookie = cookie;
  const res = await fetch(BASE + pathname, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, status: res.status, json, text };
}

/** 从 Set-Cookie 里取出 xm_session=...，并顺手校验安全属性 */
function takeSessionCookie(res, label = '响应') {
  const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const line = lines.find((item) => item.startsWith('xm_session='));
  assert.ok(line, label + ' 应通过 Set-Cookie 下发 xm_session');
  const serialized = lines.join('\n');
  assert.match(serialized, /HttpOnly/i, 'Cookie 应带 HttpOnly');
  assert.match(serialized, /SameSite=Lax/i, 'Cookie 应带 SameSite=Lax');
  assert.match(serialized, /Path=\//, 'Cookie 应带 Path=/');
  return line.split(';')[0].trim();
}

async function register(username, password = PASSWORD) {
  return request('POST', '/api/auth/register', { body: { username, password } });
}

/** 解析 SSE：按空行切块，取出 event 和 data（data 可能是对象，也可能是数组） */
function parseSse(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = null;
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!event) continue;
    const raw = dataLines.join('\n');
    events.push({ event, data: raw ? JSON.parse(raw) : null });
  }
  return events;
}

function eventsOf(events, name) {
  return events.filter((item) => item.event === name).map((item) => item.data);
}

/** 调一次助手对话，返回全部 SSE 事件 */
async function chat(payload) {
  const res = await fetch(BASE + '/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(res.status, 200, 'chat 应返回 200');
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/, 'chat 应返回 SSE');
  const text = await res.text();
  const events = parseSse(text);
  assert.ok(events.length >= 2, 'SSE 至少应包含 meta 和 done 事件');
  return { res, text, events };
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(3000).then(() => false)
  ]);
  if (exited || child.exitCode !== null) return;

  // Windows 上有个别情况下 kill 不生效，兜底强制结束进程树
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
  await Promise.race([once(child, 'exit'), delay(3000)]);
}

before(async () => {
  await assertPortFree(PORT);
  dataDir = makeTempDataDir('xiaoman-api-');
  copySeedTable(SEED_DIR, dataDir, 'products');
  copySeedTable(SEED_DIR, dataDir, 'categories');
  traceFile = path.join(dataDir, 'agent-traces.jsonl');

  child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      XM_DATA_DIR: dataDir,
      XM_TRACE_FILE: traceFile,
      AGENT_MODE: 'local',
      AGENT_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.on('error', (err) => {
    spawnError = err;
  });
  child.stdout.on('data', (buf) => {
    serverLog = (serverLog + buf.toString()).slice(-12000);
  });
  child.stderr.on('data', (buf) => {
    serverLog = (serverLog + buf.toString()).slice(-12000);
  });

  const health = await waitForHealth();
  assert.equal(health.mode, 'local', 'AGENT_MODE=local 时健康检查应报告 local');
});

after(async () => {
  await stopServer();
  if (dataDir) removeTempDir(dataDir);
});

test('健康检查：真实进程启动、隔离数据目录、local 模式', async () => {
  const { status, json } = await request('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(json.code, 0);
  assert.equal(json.data.status, 'ok');
  assert.equal(json.data.mode, 'local');
  assert.match(json.data.version, /^\d+\.\d+\.\d+$/);

  // 静态页由服务端拼公共片段：首页应有一个页脚/购物车/结算弹窗，且不能把 include 标记漏给浏览器
  const home = await fetch(BASE + '/');
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.ok(!html.includes('<!-- include:'), '页面返回前应已替换 include 标记');
  assert.equal((html.match(/<footer class="site-footer">/g) || []).length, 1);
  assert.equal((html.match(/id="cartDrawer"/g) || []).length, 1);
  assert.equal((html.match(/id="checkoutModal"/g) || []).length, 1);
  assert.ok(html.includes('id="cartShippingHint"'), '公共购物车应包含运费提示节点');

  // 404 页只拼页脚，不能把购物车/结算弹窗也塞进去
  const missing = await fetch(BASE + '/definitely-not-a-page');
  const missingHtml = await missing.text();
  assert.equal(missing.status, 404);
  assert.equal((missingHtml.match(/<footer class="site-footer">/g) || []).length, 1);
  assert.ok(!missingHtml.includes('id="cartDrawer"'));
});

test('商品列表、关键词/分类/价格筛选、排序与非法参数', async () => {
  const all = await request('GET', '/api/products');
  assert.equal(all.status, 200);
  assert.equal(all.json.data.total, 26, '真实商品数据应有 26 件');
  assert.equal(all.json.data.pageSize, 12, '默认每页 12 件');
  assert.equal(all.json.data.list.length, 12);

  const search = await request('GET', '/api/products?keyword=' + encodeURIComponent('耳机'));
  assert.ok(search.json.data.total >= 4, '耳机关键词应命中多件商品');
  assert.ok(search.json.data.list.some((item) => item.id === 'p01'));
  const haystack = (item) =>
    [item.name, item.brand, item.summary, ...(item.tags || []), ...(item.keywords || [])].join(' ').toLowerCase();
  assert.ok(search.json.data.list.every((item) => haystack(item).includes('耳机')));

  const category = await request('GET', '/api/products?category=' + encodeURIComponent('数码'));
  assert.equal(category.json.data.total, 10, '数码分类应有 10 件');
  assert.ok(category.json.data.list.every((item) => item.category === '数码'));

  const price = await request('GET', '/api/products?minPrice=100&maxPrice=300&pageSize=60');
  assert.ok(price.json.data.total > 0);
  assert.ok(price.json.data.list.every((item) => item.price >= 100 && item.price <= 300));
  assert.equal(price.json.data.filters.minPrice, 100);
  assert.equal(price.json.data.filters.maxPrice, 300);

  const asc = await request('GET', '/api/products?sort=price-asc&pageSize=60');
  const prices = asc.json.data.list.map((item) => item.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'price-asc 应升序');
  assert.equal(asc.json.data.sort, 'price-asc');

  const bad = await request('GET', '/api/products?minPrice=abc');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 40011);

  const inverted = await request('GET', '/api/products?minPrice=300&maxPrice=100');
  assert.equal(inverted.status, 400);
  assert.equal(inverted.json.code, 40012);
});

test('商品详情、关联推荐与 404', async () => {
  const detail = await request('GET', '/api/products/p01');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.id, 'p01');
  assert.equal(detail.json.data.price, 299);
  assert.equal(detail.json.data.stock, 35);

  const related = await request('GET', '/api/products/p01/related');
  assert.equal(related.status, 200);
  assert.ok(Array.isArray(related.json.data));
  assert.ok(related.json.data.length <= 4);
  assert.ok(related.json.data.every((item) => item.category === '数码' && item.id !== 'p01'));

  const missing = await request('GET', '/api/products/not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, 40401);
  assert.match(missing.json.message, /商品不存在/);
});

test('购物车：加购、累加、改数量、数量置 0 删除、清空与金额', async () => {
  const added = await request('POST', '/api/cart/items', { body: { productId: 'p09', quantity: 2 } });
  assert.equal(added.status, 200);
  assert.equal(added.json.code, 0);
  const cartId = added.json.data.id;
  assert.match(cartId, /^cart_[0-9a-f]{12}$/);
  assert.equal(added.json.data.totalQuantity, 2);
  assert.equal(added.json.data.totalAmount, 258);
  assert.equal(added.json.data.items[0].productId, 'p09');
  assert.equal(added.json.data.items[0].quantity, 2);
  assert.equal(added.json.data.items[0].subtotal, 258);

  const accumulated = await request('POST', '/api/cart/items', { body: { cartId, productId: 'p09', quantity: 1 } });
  assert.equal(accumulated.json.data.totalQuantity, 3);
  assert.equal(accumulated.json.data.totalAmount, 387);

  const read = await request('GET', '/api/cart?cartId=' + cartId);
  assert.equal(read.json.data.id, cartId);
  assert.equal(read.json.data.totalAmount, 387);
  assert.equal(read.json.data.items[0].price, 129);

  const updated = await request('PATCH', '/api/cart/items/p09', { body: { cartId, quantity: 2 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.totalQuantity, 2);
  assert.equal(updated.json.data.totalAmount, 258);

  const zero = await request('PATCH', '/api/cart/items/p09', { body: { cartId, quantity: 0 } });
  assert.equal(zero.status, 200);
  assert.equal(zero.json.data.items.length, 0);
  assert.equal(zero.json.data.totalAmount, 0);

  const readd = await request('POST', '/api/cart/items', { body: { cartId, productId: 'p11', quantity: 1 } });
  assert.equal(readd.json.data.totalAmount, 69);

  const removed = await request('DELETE', '/api/cart/items/p11?cartId=' + cartId);
  assert.equal(removed.status, 200);
  assert.equal(removed.json.data.items.length, 0);

  await request('POST', '/api/cart/items', { body: { cartId, productId: 'p11', quantity: 1 } });
  await request('POST', '/api/cart/items', { body: { cartId, productId: 'p09', quantity: 1 } });
  const cleared = await request('DELETE', '/api/cart?cartId=' + cartId);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.data.items.length, 0);
  assert.equal(cleared.json.data.totalAmount, 0);
});

test('购物车：库存上限、售罄、非法数量与未知商品', async () => {
  const cart = await request('POST', '/api/cart/items', { body: { productId: 'p07', quantity: 1 } });
  const cartId = cart.json.data.id;

  const tooMany = await request('POST', '/api/cart/items', { body: { cartId, productId: 'p07', quantity: 12 } });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.json.code, 40902);
  assert.match(tooMany.json.message, /12/);

  const stillOne = await request('GET', '/api/cart?cartId=' + cartId);
  assert.equal(stillOne.json.data.items[0].quantity, 1, '失败后原数量不应被改掉');

  const soldOut = await request('POST', '/api/cart/items', { body: { cartId, productId: 'p12', quantity: 1 } });
  assert.equal(soldOut.status, 409);
  assert.equal(soldOut.json.code, 40901);

  const badQuantity = await request('POST', '/api/cart/items', { body: { cartId, productId: 'p09', quantity: 1.5 } });
  assert.equal(badQuantity.status, 400);
  assert.equal(badQuantity.json.code, 40021);

  const missingProduct = await request('POST', '/api/cart/items', { body: { cartId, productId: 'p999', quantity: 1 } });
  assert.equal(missingProduct.status, 404);
  assert.equal(missingProduct.json.code, 40401);

  const missingRow = await request('PATCH', '/api/cart/items/p11', { body: { cartId, quantity: 2 } });
  assert.equal(missingRow.status, 404);
  assert.equal(missingRow.json.code, 40402);
});

test('下单、金额重算、运费规则、库存扣减、支付与取消回滚', async () => {
  // 场景 1：69 元商品，收 12 元运费，支付成功后不能重复支付/取消
  const p11Before = await request('GET', '/api/products/p11');
  assert.equal(p11Before.json.data.stock, 55);

  const cart = await request('POST', '/api/cart/items', { body: { productId: 'p11', quantity: 1 } });
  const cartId = cart.json.data.id;
  const receiver = { name: '接口测试', phone: '13800138000', address: '上海市浦东新区测试路 1 号' };

  const created = await request('POST', '/api/orders', { body: { cartId, receiver, remark: '接口测试订单' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.code, 0);
  const order = created.json.data;
  assert.match(order.id, /^XM\d{8}[0-9A-F]{6}$/, '订单号应是 XM+日期+6 位大写 hex');
  assert.equal(order.goodsAmount, 69);
  assert.equal(order.shippingFee, 12, '未满 99 元收 12 元运费');
  assert.equal(order.totalAmount, 81);
  assert.equal(order.totalQuantity, 1);
  assert.equal(order.status, 'pending');
  assert.equal(order.statusText, '待支付');
  assert.equal(order.userId, null, '未登录下单是游客订单');
  assert.equal(order.receiver.name, '接口测试');
  assert.equal(order.cartId, cartId);

  const cartAfter = await request('GET', '/api/cart?cartId=' + cartId);
  assert.equal(cartAfter.json.data.items.length, 0, '下单成功后购物车应清空');

  const p11After = await request('GET', '/api/products/p11');
  assert.equal(p11After.json.data.stock, 54, '下单即扣库存');

  const paid = await request('POST', '/api/orders/' + order.id + '/pay');
  assert.equal(paid.status, 200);
  assert.equal(paid.json.data.status, 'paid');
  assert.equal(paid.json.data.statusText, '已支付');
  assert.ok(paid.json.data.paidAt, '支付后应有 paidAt');

  const payAgain = await request('POST', '/api/orders/' + order.id + '/pay');
  assert.equal(payAgain.status, 409);
  assert.equal(payAgain.json.code, 40903);

  const cancelPaid = await request('POST', '/api/orders/' + order.id + '/cancel');
  assert.equal(cancelPaid.status, 409);
  assert.equal(cancelPaid.json.code, 40905);

  // 场景 2：99 元刚好免运费，取消后库存和销量都要回滚
  const p14Before = await request('GET', '/api/products/p14');
  const cart2 = await request('POST', '/api/cart/items', { body: { productId: 'p14', quantity: 1 } });
  const freeShipping = await request('POST', '/api/orders', { body: { cartId: cart2.json.data.id, receiver } });
  assert.equal(freeShipping.status, 201);
  assert.equal(freeShipping.json.data.goodsAmount, 99);
  assert.equal(freeShipping.json.data.shippingFee, 0, '满 99 元免运费');
  assert.equal(freeShipping.json.data.totalAmount, 99);

  const p14AfterOrder = await request('GET', '/api/products/p14');
  assert.equal(p14AfterOrder.json.data.stock, p14Before.json.data.stock - 1);
  assert.equal(p14AfterOrder.json.data.sales, p14Before.json.data.sales + 1);

  const cancelled = await request('POST', '/api/orders/' + freeShipping.json.data.id + '/cancel');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.data.status, 'cancelled');
  assert.equal(cancelled.json.data.statusText, '已取消');

  const p14AfterCancel = await request('GET', '/api/products/p14');
  assert.equal(p14AfterCancel.json.data.stock, p14Before.json.data.stock, '取消订单应退回库存');
  assert.equal(p14AfterCancel.json.data.sales, p14Before.json.data.sales, '取消订单应退回销量');

  const payCancelled = await request('POST', '/api/orders/' + freeShipping.json.data.id + '/pay');
  assert.equal(payCancelled.status, 409);
  assert.equal(payCancelled.json.code, 40904);
});

test('注册、重复用户名、错误密码、登录 Cookie 与 401', async () => {
  const noLogin = await request('GET', '/api/orders');
  assert.equal(noLogin.status, 401);
  assert.equal(noLogin.json.code, 40102);
  assert.equal(noLogin.json.message, '请先登录');

  const username = 'api_' + STAMP + '_a';
  const registered = await register(username);
  assert.equal(registered.status, 201);
  assert.equal(registered.json.code, 0);
  assert.equal(registered.json.data.user.username, username);
  assert.ok(!('passwordHash' in registered.json.data.user), '接口不能返回 passwordHash');
  assert.ok(!('salt' in registered.json.data.user), '接口不能返回 salt');
  const cookieA = takeSessionCookie(registered.res, '注册响应');

  const me = await request('GET', '/api/auth/me', { cookie: cookieA });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.user.id, registered.json.data.user.id);

  const authedOrders = await request('GET', '/api/orders', { cookie: cookieA });
  assert.equal(authedOrders.status, 200);
  assert.ok(Array.isArray(authedOrders.json.data));

  const duplicate = await register(username.toUpperCase(), PASSWORD);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.code, 40941);

  const wrong = await request('POST', '/api/auth/login', { body: { username, password: 'wrong-pass' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.code, 40141);
  assert.equal(wrong.json.message, '用户名或密码不正确');

  const login = await request('POST', '/api/auth/login', { body: { username: username.toUpperCase(), password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.json.data.user.id, registered.json.data.user.id);
  const cookieB = takeSessionCookie(login.res, '登录响应');

  const meAgain = await request('GET', '/api/auth/me', { cookie: cookieB });
  assert.equal(meAgain.json.data.user.id, registered.json.data.user.id);

  const logout = await request('POST', '/api/auth/logout', { cookie: cookieB });
  assert.equal(logout.status, 200);
  assert.equal(logout.json.data.loggedOut, true);

  const meAfterLogout = await request('GET', '/api/auth/me', { cookie: cookieB });
  assert.equal(meAfterLogout.status, 200);
  assert.equal(meAfterLogout.json.data.user, null, '退出后旧 token 应失效');

  const ordersAfterLogout = await request('GET', '/api/orders', { cookie: cookieB });
  assert.equal(ordersAfterLogout.status, 401);
  assert.equal(ordersAfterLogout.json.code, 40102);

  const invalidToken = await request('GET', '/api/orders', { cookie: 'xm_session=deadbeef' });
  assert.equal(invalidToken.status, 401);
  assert.equal(invalidToken.json.code, 40102);
});

test('订单归属：未登录 403、他人订单 403、本人可见', async () => {
  const ownerName = 'api_' + STAMP + '_owner';
  const otherName = 'api_' + STAMP + '_other';
  const owner = await register(ownerName);
  const other = await register(otherName);
  assert.equal(owner.status, 201);
  assert.equal(other.status, 201);
  const ownerCookie = takeSessionCookie(owner.res, 'owner 注册');
  const otherCookie = takeSessionCookie(other.res, 'other 注册');

  const cart = await request('POST', '/api/cart/items', { body: { productId: 'p15', quantity: 1 } });
  const created = await request('POST', '/api/orders', {
    cookie: ownerCookie,
    body: {
      cartId: cart.json.data.id,
      receiver: { name: '归属测试', phone: '13900139000', address: '北京市朝阳区测试路 2 号' }
    }
  });
  assert.equal(created.status, 201);
  const orderId = created.json.data.id;
  assert.equal(created.json.data.userId, owner.json.data.user.id);

  const byOther = await request('GET', '/api/orders/' + orderId, { cookie: otherCookie });
  assert.equal(byOther.status, 403);
  assert.equal(byOther.json.code, 40301);

  const payByOther = await request('POST', '/api/orders/' + orderId + '/pay', { cookie: otherCookie });
  assert.equal(payByOther.status, 403);
  assert.equal(payByOther.json.code, 40301);

  const byGuest = await request('GET', '/api/orders/' + orderId);
  assert.equal(byGuest.status, 403);
  assert.equal(byGuest.json.code, 40301);

  const byOwner = await request('GET', '/api/orders/' + orderId, { cookie: ownerCookie });
  assert.equal(byOwner.status, 200);
  assert.equal(byOwner.json.data.id, orderId);

  const ownerList = await request('GET', '/api/orders', { cookie: ownerCookie });
  assert.ok(ownerList.json.data.some((item) => item.id === orderId));

  const otherList = await request('GET', '/api/orders', { cookie: otherCookie });
  assert.ok(!otherList.json.data.some((item) => item.id === orderId), '他人订单不应出现在列表里');
});

test('AI 助手 local 模式：搜索、加购、待确认动作、确认下单与会话恢复', async () => {
  const first = await chat({ message: '300 元以内的耳机' });
  const meta = eventsOf(first.events, 'meta')[0];
  assert.ok(meta, '应发送 meta 事件');
  assert.equal(meta.mode, 'local');
  assert.match(meta.conversationId, /^conv_[0-9a-f]{12}$/);
  const conversationId = meta.conversationId;

  const productPayloads = eventsOf(first.events, 'products');
  assert.ok(productPayloads.length >= 1, '搜索应发送 products 事件');
  const cards = productPayloads[0];
  assert.ok(Array.isArray(cards), 'products 事件的 data 是商品数组');
  assert.ok(cards.length > 0);
  assert.ok(cards.every((item) => item.price <= 300));
  assert.ok(cards.some((item) => item.id === 'p01'), '应命中 299 元的听风耳机');

  const done1 = eventsOf(first.events, 'done').at(-1);
  assert.ok(done1, '第一轮应有 done 事件');
  assert.equal(done1.conversationId, conversationId);
  assert.equal(done1.mode, 'local');
  assert.ok(done1.products.some((item) => item.id === 'p01'));
  assert.match(done1.reply, /找到/);

  const second = await chat({ conversationId, message: '把第一个加入购物车' });
  const cartPayloads = eventsOf(second.events, 'cart');
  assert.equal(cartPayloads.length, 1, '加购应发送一次 cart 事件');
  const cart = cartPayloads[0];
  assert.match(cart.id, /^cart_[0-9a-f]{12}$/);
  assert.equal(cart.totalQuantity, 1);
  assert.equal(cart.totalAmount, 299);
  assert.equal(cart.items[0].productId, 'p01');
  assert.equal(cart.items[0].quantity, 1);

  const done2 = eventsOf(second.events, 'done').at(-1);
  assert.equal(done2.cartId, cart.id);

  const cartFromApi = await request('GET', '/api/cart?cartId=' + cart.id);
  assert.equal(cartFromApi.json.data.totalAmount, 299, '助手加购结果应落到同一购物车');

  const third = await chat({ conversationId, message: '下单' });
  const actions = eventsOf(third.events, 'action');
  assert.equal(actions.length, 1, '下单应生成一次待确认动作');
  const action = actions[0];
  assert.equal(action.type, 'create_order');
  assert.equal(action.status, 'pending');
  assert.match(action.id, /^act_/);
  assert.equal(action.amount, 299);
  assert.equal(action.quantity, 1);

  const done3 = eventsOf(third.events, 'done').at(-1);
  assert.equal(done3.action.id, action.id);
  assert.equal(done3.conversationId, conversationId);

  // 收货信息不合法：动作保持 pending，不能创建订单
  const invalid = await request('POST', '/api/agent/confirm', {
    body: { conversationId, actionId: action.id, approved: true, receiver: { name: '测', phone: '123', address: '短' } }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.code, 40041);

  const confirmed = await request('POST', '/api/agent/confirm', {
    body: {
      conversationId,
      actionId: action.id,
      approved: true,
      receiver: { name: '接口测试', phone: '13800138000', address: '上海市浦东新区测试路 1 号' }
    }
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.code, 0);
  assert.equal(confirmed.json.data.cancelled, false);
  assert.equal(confirmed.json.data.conversationId, conversationId);
  const order = confirmed.json.data.order;
  assert.match(order.id, /^XM\d{8}[0-9A-F]{6}$/);
  assert.equal(order.goodsAmount, 299);
  assert.equal(order.shippingFee, 0, '299 元免运费');
  assert.equal(order.totalAmount, 299);
  assert.equal(order.status, 'pending');
  assert.equal(order.items[0].productId, 'p01');
  assert.equal(order.items[0].price, 299);

  const emptyCart = await request('GET', '/api/cart?cartId=' + cart.id);
  assert.equal(emptyCart.json.data.items.length, 0, '确认下单后购物车应清空');

  const confirmAgain = await request('POST', '/api/agent/confirm', {
    body: {
      conversationId,
      actionId: action.id,
      approved: true,
      receiver: { name: '接口测试', phone: '13800138000', address: '上海市浦东新区测试路 1 号' }
    }
  });
  assert.equal(confirmAgain.status, 409);
  assert.equal(confirmAgain.json.code, 40931);

  const conversation = await request('GET', '/api/agent/conversation/' + conversationId);
  assert.equal(conversation.status, 200);
  assert.equal(conversation.json.data.id, conversationId);
  assert.ok(Array.isArray(conversation.json.data.messages));
  assert.ok(conversation.json.data.messages.length >= 6, '三轮对话 + 确认回复都应落盘');
  assert.ok(conversation.json.data.messages.every((item) => item.role && typeof item.content === 'string'));
  assert.equal(conversation.json.data.pending.length, 0, '已处理动作不再出现在 pending 列表');

  // Trace 必须写到 XM_TRACE_FILE 指定的临时目录，而不是 server/data
  assert.ok(fs.existsSync(traceFile), '助手 Trace 应写入 XM_TRACE_FILE');
  const lines = fs.readFileSync(traceFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 4, '三轮对话 + 一次确认至少 4 条 Trace');
  const records = lines.map((line) => JSON.parse(line));
  assert.ok(records.some((item) => item.type === 'confirm'));
  assert.ok(records.every((item) => item.conversationId === conversationId));
});
