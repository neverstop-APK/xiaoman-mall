#!/usr/bin/env node
/**
 * Xiaoman Mall AI shopping assistant evaluation runner.
 *
 * What it is:
 * - Zero-dependency Node.js end-to-end harness for tests/eval/评测用例-ai助手.json.
 * - Starts an isolated server on port 3211 with XM_DATA_DIR=tests/eval/.tmpdata,
 *   copies product/category seed files, sends HTTP/SSE requests, and checks
 *   tool calls, arguments, products, carts, actions, conversations, and streaming.
 * - Writes tests/eval/评测结果.json and docs/AI评测报告.md.
 *
 * 这个文件干什么：
 * - 启动隔离服务，逐条执行 9.1-9.7 的评测用例，不触碰 server/data 和 3000 端口。
 * - 解析 SSE 的 meta/status/notice/delta/products/cart/action/error/done 事件。
 * - 统计工具选择正确率、参数正确率、任务完成率、幻觉率、拒答/澄清正确率。
 * - 失败不放宽断言；产品缺陷写入报告，不修改后端业务代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index-服务入口.js');
const SEED_PRODUCTS = path.join(ROOT, 'server', 'data', 'products-商品数据.json');
const SEED_CATEGORIES = path.join(ROOT, 'server', 'data', 'categories-商品分类.json');
const DATA_DIR = path.join(HERE, '.tmpdata');
const TRACE_FILE = path.join(DATA_DIR, 'agent-traces.jsonl');
const CASE_FILE = path.join(HERE, '评测用例-ai助手.json');
const RESULT_FILE = path.join(HERE, '评测结果.json');
const REPORT_FILE = path.join(ROOT, 'docs', 'AI评测报告.md');
const NODE_BIN = process.env.XM_EVAL_NODE || process.execPath;
const DEFAULT_PORT = Number(process.env.XM_EVAL_PORT || 3211);
const PASSWORD = 'eval123456';

const GROUPS = [
  ['9.1', '对话与商品问答'],
  ['9.2', 'searchProducts 工具'],
  ['9.3', '多轮对话与约束'],
  ['9.4', '写操作与确认'],
  ['9.5', '多步规划与约束冲突'],
  ['9.6', '歧义、拒答与异常'],
  ['9.7', '流式输出与会话恢复']
];

const DEFECTS = [
  {
    id: 'D01',
    title: '分类识别链路失效，category 参数被丢弃',
    severity: '高',
    cases: ['c07'],
    rootCause: 'server/agent/tools-工具集.js:141-166 的 CATEGORY_ALIASES 以 digital/home/... 英文 key 建表，但 catalog.categories() 返回的 key 是中文（数码/家居/文具/户外/服饰/配件）；resolveCategory 用中文 key 查表恒为空。商品分类 JSON 也没有 name 字段，byName 分支同样失效。',
    recommendation: '统一分类 key，或同时支持中英文别名；为 categories 增加 name 字段；补单测覆盖“家居”和“home”两种输入。'
  },
  {
    id: 'D02',
    title: '“最便宜”分支丢失商品关键词',
    severity: '高',
    cases: ['c08'],
    rootCause: 'server/agent/localbrain-本地规则引擎.js:488-493 命中“最便宜/最低价”时只传 {sort:"price-asc", limit:6, category}，没有传 keyword；因此“最便宜的降噪耳机”退化成全站最低价，p25 耳机套排到第一。',
    recommendation: '该分支复用普通搜索逻辑，保留 keyword、价格区间和排序条件；或把“最便宜”作为 sort 修饰符合并进搜索。'
  },
  {
    id: 'D03',
    title: '价格区间文本污染关键词',
    severity: '中',
    cases: ['c09'],
    rootCause: 'server/agent/localbrain-本地规则引擎.js:59-67 的 keywordOf 只清理“X以内/以下/左右”等价格短语，未清理“X到Y元”中的数字；最终 keyword 为“500到800 耳机”，catalog 的 includes 匹配不到任何商品。',
    recommendation: '先剥离完整价格区间，或让 parsePrice 返回区间文本位置并从关键词中删除。'
  },
  {
    id: 'D04',
    title: '详情追问与“这个”指代不使用 get_product',
    severity: '高',
    cases: ['c04', 'c13'],
    rootCause: 'server/agent/localbrain-本地规则引擎.js 的搜索分支只做 keyword 检索，没有识别“卖点/多少钱”等详情意图；resolveProduct 只在加购、改数量、删除路径调用，搜索路径不解析“这个/上一件”。结果 c04 搜索“听风 Air One 卖点”为 0 件，c13 搜索“这 多少”为 0 件。',
    recommendation: '新增详情意图分支：先 resolveProduct（含上一轮 lastProducts[0]）得到 productId，再调用 get_product；不要把“卖点/多少钱”拼进关键词。'
  },
  {
    id: 'D05',
    title: '价格约束冲突未识别',
    severity: '中',
    cases: ['c20'],
    rootCause: 'server/agent/localbrain-本地规则引擎.js:70-87 的 parsePrice 只取到“300以内”的 maxPrice，keywordOf 又保留“又 500 以上 耳机”，没有检测 minPrice > maxPrice 的空集条件，最终直接搜索并回复“没找到”。',
    recommendation: '同时解析“X以上”的 minPrice，在搜索前检测 minPrice > maxPrice，返回澄清话术并要求用户二选一。'
  }
];

let activeServer = null;

function usage() {
  console.log('小满商城 AI 购物助手评测');
  console.log('用法: node tests/eval/run-评测.mjs [--case=c01,c02] [--mode=local|llm] [--keep-data] [--clean] [--port=3211]');
}

function parseArgs(argv) {
  const options = { mode: 'local', keepData: false, clean: false, cases: null, port: DEFAULT_PORT, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--keep-data') { options.keepData = true; continue; }
    if (arg === '--clean') { options.clean = true; continue; }
    if (arg.indexOf('--mode=') === 0) { options.mode = arg.slice(7); continue; }
    if (arg === '--mode') { options.mode = String(argv[++i] || ''); continue; }
    if (arg.indexOf('--case=') === 0) { options.cases = arg.slice(7).split(',').filter(Boolean); continue; }
    if (arg === '--case') { options.cases = String(argv[++i] || '').split(',').filter(Boolean); continue; }
    if (arg.indexOf('--port=') === 0) { options.port = Number(arg.slice(7)); continue; }
    if (arg === '--port') { options.port = Number(argv[++i]); continue; }
    throw new Error('未知参数: ' + arg);
  }
  if (options.mode !== 'local' && options.mode !== 'llm') throw new Error('--mode 只能是 local 或 llm');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('端口不合法');
  return options;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cut(value, max) {
  const text = String(value === undefined || value === null ? '' : value);
  return text.length > (max || 300) ? text.slice(0, max || 300) + '...' : text;
}
function show(value, max) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return cut(value, max || 500);
  try { return cut(JSON.stringify(value), max || 500); } catch { return cut(String(value), max || 500); }
}
function pct(rate) { return (Number(rate || 0) * 100).toFixed(1) + '%'; }
function duration(ms) { return Number(ms) >= 1000 ? (Number(ms) / 1000).toFixed(2) + 's' : Math.round(Number(ms) || 0) + 'ms'; }
function time(iso) { return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'; }

function prepareData(keep) {
  if (!fs.existsSync(SEED_PRODUCTS)) throw new Error('缺少商品种子: ' + SEED_PRODUCTS);
  if (!fs.existsSync(SEED_CATEGORIES)) throw new Error('缺少分类种子: ' + SEED_CATEGORIES);
  if (!keep) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pairs = [
    [SEED_PRODUCTS, path.join(DATA_DIR, 'products-商品数据.json')],
    [SEED_CATEGORIES, path.join(DATA_DIR, 'categories-商品分类.json')]
  ];
  for (const pair of pairs) if (!fs.existsSync(pair[1])) fs.copyFileSync(pair[0], pair[1]);
}

function portFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => {
      probe.close(() => {});
      reject(error.code === 'EADDRINUSE' ? new Error('端口 ' + port + ' 已被占用，请用 --port 换端口') : error);
    });
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

function loadCatalog() {
  const products = JSON.parse(fs.readFileSync(SEED_PRODUCTS, 'utf8'));
  return {
    products,
    byId: new Map(products.map((item) => [item.id, item])),
    names: products.map((item) => item.name).sort((a, b) => b.length - a.length),
    prices: new Set(products.map((item) => Number(item.price))),
    brands: new Set(products.map((item) => item.brand).filter(Boolean))
  };
}

class Server {
  constructor(options) { this.options = options; this.child = null; this.logs = []; this.exitInfo = null; this.spawnError = null; }
  env() {
    return { ...process.env, PORT: String(this.options.port), HOST: '127.0.0.1', XM_DATA_DIR: DATA_DIR, XM_TRACE_FILE: TRACE_FILE, AGENT_MODE: this.options.mode === 'llm' ? 'llm' : 'local' };
  }
  log(stream, chunk) {
    for (const line of String(chunk || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.logs.push('[' + stream + '] ' + line);
      if (this.logs.length > 200) this.logs.shift();
    }
  }
  async start() {
    if (this.child) throw new Error('服务已在运行');
    this.logs = []; this.exitInfo = null; this.spawnError = null;
    this.child = spawn(NODE_BIN, [SERVER_ENTRY], { cwd: ROOT, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.log('out', chunk));
    this.child.stderr.on('data', (chunk) => this.log('err', chunk));
    this.child.on('error', (error) => { this.spawnError = error; });
    this.child.on('exit', (code, signal) => { this.exitInfo = { code, signal }; });
    await this.ready();
  }
  async ready() {
    const base = 'http://127.0.0.1:' + this.options.port;
    for (let i = 0; i < 200; i += 1) {
      if (this.spawnError) throw new Error('服务启动失败: ' + this.spawnError.message);
      if (this.exitInfo) throw new Error('服务提前退出: ' + JSON.stringify(this.exitInfo) + '\n' + this.logs.slice(-20).join('\n'));
      try {
        const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(800) });
        if (response.ok) {
          const json = await response.json();
          if (json && json.code === 0) return;
        }
      } catch {}
      await sleep(100);
    }
    throw new Error('等待服务就绪超时\n' + this.logs.slice(-40).join('\n'));
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    if (child.exitCode !== null) return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      child.once('exit', finish);
      try { child.kill(); } catch {}
      const timer = setTimeout(() => {
        if (done) return;
        try { child.kill('SIGKILL'); } catch {}
        setTimeout(finish, 800);
      }, 5000);
      timer.unref();
    });
  }
  async restart() { await this.stop(); await sleep(300); await this.start(); }
}

function setCookiesFrom(headers) {
  if (typeof headers.getSetCookie === 'function') {
    const list = headers.getSetCookie();
    if (Array.isArray(list) && list.length) return list;
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}
function applyCookies(jar, list) {
  for (const header of list || []) {
    const pair = String(header).split(';')[0];
    const at = pair.indexOf('=');
    if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
}
function cookieText(jar) { return Object.keys(jar || {}).map((key) => key + '=' + jar[key]).join('; '); }

async function request(port, method, pathname, options) {
  const opts = options || {};
  const headers = { Accept: 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  let body;
  if (opts.rawBody !== undefined) { headers['Content-Type'] = 'application/json'; body = String(opts.rawBody); }
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const response = await fetch('http://127.0.0.1:' + port + pathname, { method, headers, body, signal: AbortSignal.timeout(opts.timeout || 20000) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json, setCookies: setCookiesFrom(response.headers) };
}

function parseBlock(block, events) {
  let event = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (!line || line.charAt(0) === ':') continue;
    const at = line.indexOf(':');
    const field = at === -1 ? line : line.slice(0, at);
    let value = at === -1 ? '' : line.slice(at + 1);
    if (value.charAt(0) === ' ') value = value.slice(1);
    if (field === 'event') event = value.trim() || 'message';
    if (field === 'data') data.push(value);
  }
  if (!data.length) return;
  const raw = data.join('\n');
  let parsed = raw;
  try { parsed = JSON.parse(raw); } catch {}
  events.push({ index: events.length, event, data: parsed, raw });
}

async function readSse(response) {
  if (!response.body) throw new Error('SSE 无 body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  const drain = () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let at = buffer.indexOf('\n\n');
    while (at !== -1) {
      parseBlock(buffer.slice(0, at), events);
      buffer = buffer.slice(at + 2);
      at = buffer.indexOf('\n\n');
    }
  };
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    drain();
  }
  buffer += decoder.decode();
  drain();
  if (buffer.trim()) parseBlock(buffer, events);
  return events;
}

function normalize(events, status, contentType, sentId, parseError) {
  const list = events || [];
  const metaEvent = list.find((item) => item.event === 'meta');
  const doneEvent = [...list].reverse().find((item) => item.event === 'done');
  const errorEvent = list.find((item) => item.event === 'error');
  const productEvent = [...list].reverse().find((item) => item.event === 'products');
  const carts = list.filter((item) => item.event === 'cart');
  const actions = list.filter((item) => item.event === 'action');
  const deltas = list.filter((item) => item.event === 'delta');
  const notices = list.filter((item) => item.event === 'notice');
  const done = doneEvent ? doneEvent.data : null;
  const meta = metaEvent ? metaEvent.data : null;
  const deltaText = deltas.map((item) => item.data && typeof item.data.text === 'string' ? item.data.text : '').join('');
  const reply = done && typeof done.reply === 'string' ? done.reply : deltaText;
  const error = errorEvent ? errorEvent.data : done && done.error ? { code: null, message: 'done.error' } : null;
  return {
    status, contentType, events: list, done, meta, error,
    parseError: parseError || '',
    hasError: Boolean(error) || Boolean(parseError) || Boolean(done && done.error),
    reply: String(reply || ''),
    deltas: deltas.map((item) => item.data && typeof item.data.text === 'string' ? item.data.text : ''),
    deltaText,
    products: done && Array.isArray(done.products) ? done.products : productEvent && Array.isArray(productEvent.data) ? productEvent.data : [],
    toolCalls: done && Array.isArray(done.toolCalls) ? done.toolCalls : [],
    action: actions.length ? actions[actions.length - 1].data : done && done.action ? done.action : null,
    cart: carts.length ? carts[carts.length - 1].data : null,
    cartEvents: carts.length,
    actionEvents: actions.length,
    notices: notices.map((item) => item.data && item.data.text || ''),
    conversationId: done && done.conversationId || meta && meta.conversationId || sentId || '',
    mode: done && done.mode || meta && meta.mode || '',
    productIndex: productEvent ? productEvent.index : -1,
    doneIndex: doneEvent ? doneEvent.index : -1
  };
}

async function chat(port, message, conversationId, cookie) {
  const body = { message };
  if (conversationId) body.conversationId = conversationId;
  const response = await fetch('http://127.0.0.1:' + port + '/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  const type = response.headers.get('content-type') || '';
  if (type.toLowerCase().indexOf('text/event-stream') === -1) {
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const messageText = json && json.code ? json.message : '响应不是 text/event-stream: ' + cut(text, 200);
    return normalize([], response.status, type, conversationId || '', messageText);
  }
  return normalize(await readSse(response), response.status, type, conversationId || '', '');
}

function fill(value, ctx) {
  return String(value === undefined || value === null ? '' : value).replace(/\{\{(\w+)\}\}/g, (all, key) => ctx[key] === undefined || ctx[key] === null ? '' : String(ctx[key]));
}
function materialize(value, ctx) {
  if (typeof value === 'string') return fill(value, ctx);
  if (Array.isArray(value)) return value.map((item) => materialize(item, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = materialize(value[key], ctx);
    return out;
  }
  return value;
}
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a); const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((key) => same(a[key], b[key]));
  }
  return false;
}
function match(actual, matcher) {
  if (matcher && typeof matcher === 'object' && !Array.isArray(matcher)) {
    const ops = Object.keys(matcher).filter((key) => key.charAt(0) === '$');
    if (ops.length) {
      return ops.every((op) => {
        const want = matcher[op];
        if (op === '$eq') return actual === want;
        if (op === '$ne') return actual !== want;
        if (op === '$lte') return Number.isFinite(Number(actual)) && Number(actual) <= Number(want);
        if (op === '$lt') return Number.isFinite(Number(actual)) && Number(actual) < Number(want);
        if (op === '$gte') return Number.isFinite(Number(actual)) && Number(actual) >= Number(want);
        if (op === '$gt') return Number.isFinite(Number(actual)) && Number(actual) > Number(want);
        if (op === '$includes') return Array.isArray(actual) ? actual.includes(want) : actual !== undefined && actual !== null && String(actual).includes(String(want));
        if (op === '$notIncludes') return Array.isArray(actual) ? !actual.includes(want) : actual === undefined || actual === null || !String(actual).includes(String(want));
        if (op === '$oneOf') return Array.isArray(want) && want.some((item) => same(actual, item));
        if (op === '$absent') return actual === undefined || actual === null || actual === '';
        if (op === '$truthy') return Boolean(actual);
        if (op === '$regex') { try { return new RegExp(String(want)).test(String(actual === undefined || actual === null ? '' : actual)); } catch { return false; } }
        if (op === '$minLength') return String(actual === undefined || actual === null ? '' : actual).length >= Number(want);
        return false;
      });
    }
  }
  return same(actual, matcher);
}

function check(checks, name, kind, ok, expected, actual) {
  checks.push({ name, kind, ok: Boolean(ok), expected: show(expected), actual: show(actual) });
  return Boolean(ok);
}

function evalTools(checks, expect, res) {
  const names = (res.toolCalls || []).map((item) => item.name);
  if (Array.isArray(expect.tools)) check(checks, '工具选择', 'tools', same(names, expect.tools), expect.tools, names);
  if (Array.isArray(expect.toolsAny)) {
    check(checks, '工具选择（任一）', 'tools', expect.toolsAny.some((item) => Array.isArray(item) && same(names, item)), expect.toolsAny, names);
  }
}
function evalArgs(checks, expect, res) {
  const alternatives = Array.isArray(expect.toolsAny) ? expect.toolsAny : Array.isArray(expect.tools) ? [expect.tools] : null;
  for (const tool of Object.keys(expect.toolArgs || {})) {
    const calls = (res.toolCalls || []).filter((item) => item.name === tool);
    const required = alternatives ? alternatives.every((list) => Array.isArray(list) && list.includes(tool)) : true;
    if (!calls.length) {
      if (required) for (const key of Object.keys(expect.toolArgs[tool] || {})) check(checks, '参数 ' + tool + '.' + key, 'tool_param', false, expect.toolArgs[tool][key], '工具未调用');
      continue;
    }
    const args = calls[0].args || {};
    for (const key of Object.keys(expect.toolArgs[tool] || {})) check(checks, '参数 ' + tool + '.' + key, 'tool_param', match(args[key], expect.toolArgs[tool][key]), expect.toolArgs[tool][key], args[key]);
  }
}
function evalProducts(checks, spec, products) {
  const list = Array.isArray(products) ? products : [];
  const ids = list.map((item) => item.id);
  if (spec.minCount !== undefined) check(checks, '商品数量下限', 'products', list.length >= spec.minCount, '>= ' + spec.minCount, list.length);
  if (spec.maxCount !== undefined) check(checks, '商品数量上限', 'products', list.length <= spec.maxCount, '<= ' + spec.maxCount, list.length);
  if (spec.noProducts) check(checks, '不返回商品', 'products', list.length === 0, 0, list.length);
  if (Array.isArray(spec.idsInclude)) {
    const missing = spec.idsInclude.filter((id) => !ids.includes(id));
    check(checks, '商品包含指定 id', 'products', missing.length === 0, spec.idsInclude, { ids, missing });
  }
  if (Array.isArray(spec.idsEqual)) check(checks, '商品 id 完全匹配', 'products', same(ids, spec.idsEqual), spec.idsEqual, ids);
  if (spec.firstId !== undefined) check(checks, '首件商品 id', 'products', Boolean(list[0]) && list[0].id === spec.firstId, spec.firstId, list[0] && list[0].id);
  if (spec.allPrice !== undefined) {
    const bad = list.filter((item) => !match(Number(item.price), spec.allPrice)).map((item) => item.id + ':' + item.price);
    check(checks, '全部价格满足条件', 'products', list.length > 0 && bad.length === 0, spec.allPrice, { prices: list.map((item) => item.price), bad });
  }
  if (spec.allCategory !== undefined) {
    const bad = list.filter((item) => item.category !== spec.allCategory).map((item) => item.id + ':' + item.category);
    check(checks, '全部分类匹配', 'products', list.length > 0 && bad.length === 0, spec.allCategory, { categories: list.map((item) => item.category), bad });
  }
  if (spec.allNamesContain !== undefined) {
    const bad = list.filter((item) => !String(item.name || '').includes(spec.allNamesContain)).map((item) => item.name);
    check(checks, '全部商品名包含', 'products', list.length > 0 && bad.length === 0, spec.allNamesContain, bad);
  }
}
function evalCart(checks, spec, res) {
  if (!res.cart) { check(checks, '购物车事件存在', 'cart', false, 'cart 事件', '无'); return; }
  if (spec.quantity !== undefined) check(checks, '购物车总件数', 'cart', match(res.cart.totalQuantity, spec.quantity), spec.quantity, res.cart.totalQuantity);
  if (spec.amount !== undefined) check(checks, '购物车总金额', 'cart', match(res.cart.totalAmount, spec.amount), spec.amount, res.cart.totalAmount);
  if (Array.isArray(spec.items)) {
    const actual = (res.cart.items || []).map((item) => ({ productId: item.productId, quantity: item.quantity }));
    const missing = spec.items.filter((want) => !actual.some((item) => item.productId === want.productId && match(item.quantity, want.quantity)));
    const extra = actual.filter((item) => !spec.items.some((want) => want.productId === item.productId));
    check(checks, '购物车商品项', 'cart', actual.length === spec.items.length && missing.length === 0 && extra.length === 0, spec.items, actual);
  }
}
function evalAction(checks, spec, res) {
  const action = res.action;
  const exists = res.actionEvents > 0 && Boolean(action);
  check(checks, '待确认动作事件存在', 'action', exists, 'action 事件', { events: res.actionEvents, action });
  if (!exists) return;
  if (spec.status !== undefined) check(checks, '动作状态', 'action', match(action.status, spec.status), spec.status, action.status);
  if (spec.type !== undefined) check(checks, '动作类型', 'action', match(action.type, spec.type), spec.type, action.type);
  if (spec.amount !== undefined) check(checks, '动作金额', 'action', match(action.amount, spec.amount), spec.amount, action.amount);
}
function evalReply(checks, expect, res) {
  const reply = String(res.reply || '');
  for (const text of expect.replyContains || []) check(checks, '回复包含 ' + cut(text, 40), 'reply', reply.includes(String(text)), text, reply);
  if (expect.replyRegex !== undefined) {
    let regex = null;
    try { regex = new RegExp(String(expect.replyRegex), 'i'); } catch {}
    check(checks, '回复匹配正则', 'reply', Boolean(regex) && regex.test(reply), expect.replyRegex, reply);
  }
  for (const text of expect.replyNotContains || []) check(checks, '回复不包含 ' + text, 'reply', !reply.includes(String(text)), '不包含 ' + text, reply);
}
function evalStream(checks, res) {
  const type = String(res.contentType || '').toLowerCase();
  check(checks, 'SSE Content-Type', 'stream', type.includes('text/event-stream'), 'text/event-stream', res.contentType);
  const events = res.events || [];
  check(checks, '首事件为 meta', 'stream', events[0] && events[0].event === 'meta', 'meta', events[0] && events[0].event);
  check(checks, '末事件为 done', 'stream', events.length > 0 && events[events.length - 1].event === 'done', 'done', events.length ? events[events.length - 1].event : '无');
  check(checks, '至少一个 delta', 'stream', (res.deltas || []).length >= 1, '>= 1', (res.deltas || []).length);
  check(checks, 'delta 拼接等于 reply', 'stream', res.done && typeof res.done.reply === 'string' && res.deltaText === res.done.reply, '相等', { delta: cut(res.deltaText, 200), reply: cut(res.done && res.done.reply, 200) });
  if (res.productIndex >= 0 && res.doneIndex >= 0) check(checks, 'products 先于 done', 'stream', res.productIndex < res.doneIndex, 'products < done', { products: res.productIndex, done: res.doneIndex });
  check(checks, '无 error 事件', 'stream', !res.hasError, '无错误', res.error || res.parseError || '');
}
function evalOrder(checks, order, res) {
  let last = -1;
  const found = [];
  for (const name of order || []) {
    const index = (res.events || []).findIndex((item) => item.event === name);
    found.push({ name, index });
    if (index === -1 || index <= last) { check(checks, '事件顺序 ' + order.join(' -> '), 'stream', false, order, found); return; }
    last = index;
  }
  check(checks, '事件顺序 ' + order.join(' -> '), 'stream', true, order, found);
}
function evalChat(checks, expect, res, ctx) {
  if (expect.httpStatus !== undefined) check(checks, 'HTTP 状态', 'http', res.status === expect.httpStatus, expect.httpStatus, res.status);
  if (expect.contentType !== undefined) check(checks, 'Content-Type', 'http', String(res.contentType || '').includes(expect.contentType), expect.contentType, res.contentType);
  if (expect.noError) check(checks, '无错误', 'error', !res.hasError, '无错误', res.error || res.parseError || '');
  if (expect.errorCode !== undefined) check(checks, 'SSE 错误码', 'error', Boolean(res.error) && Number(res.error.code) === Number(expect.errorCode), expect.errorCode, res.error);
  if (expect.doneError !== undefined) check(checks, 'done.error', 'error', Boolean(res.done && res.done.error) === Boolean(expect.doneError), expect.doneError, res.done && res.done.error);
  if (expect.deltasMin !== undefined) check(checks, 'delta 数量下限', 'stream', (res.deltas || []).length >= expect.deltasMin, '>= ' + expect.deltasMin, (res.deltas || []).length);
  if (expect.deltasMax !== undefined) check(checks, 'delta 数量上限', 'stream', (res.deltas || []).length <= expect.deltasMax, '<= ' + expect.deltasMax, (res.deltas || []).length);
  evalTools(checks, expect, res);
  evalArgs(checks, expect, res);
  evalReply(checks, expect, res);
  if (expect.products) evalProducts(checks, expect.products, res.products);
  if (expect.cart) evalCart(checks, expect.cart, res);
  if (expect.action) evalAction(checks, expect.action, res);
  if (expect.noCartEvent) check(checks, '无购物车事件', 'cart', res.cartEvents === 0, 0, res.cartEvents);
  if (expect.noActionEvent) check(checks, '无动作事件', 'action', res.actionEvents === 0, 0, res.actionEvents);
  if (expect.streaming) evalStream(checks, res);
  if (Array.isArray(expect.eventOrder)) evalOrder(checks, expect.eventOrder, res);
}

function evalRegister(checks, res) {
  check(checks, '注册 HTTP 状态', 'http', res.status === 201, 201, res.status);
  check(checks, '注册业务 code', 'http', Boolean(res.json && res.json.code === 0), 0, res.json && res.json.code);
  check(checks, '注册用户 id', 'auth', Boolean(res.json && res.json.data && res.json.data.user && res.json.data.user.id), 'user.id', res.json && res.json.data && res.json.data.user && res.json.data.user.id);
  check(checks, '注册 Cookie', 'auth', (res.setCookies || []).length > 0, 'Set-Cookie', (res.setCookies || []).length);
}
function evalConfirm(checks, expect, res) {
  const data = res.json && res.json.data ? res.json.data : {};
  if (expect.httpStatus !== undefined) check(checks, '确认 HTTP 状态', 'http', res.status === expect.httpStatus, expect.httpStatus, res.status);
  check(checks, '确认业务 code', 'http', Boolean(res.json && res.json.code === 0), 0, res.json && res.json.code);
  if (expect.cancelled !== undefined) check(checks, 'cancelled', 'confirm', data.cancelled === expect.cancelled, expect.cancelled, data.cancelled);
  if (expect.noOrder) check(checks, '未创建订单', 'confirm', !data.order, '无 order', data.order && data.order.id);
  const order = data.order || null;
  if (expect.orderIdRegex !== undefined) {
    let regex = null;
    try { regex = new RegExp(String(expect.orderIdRegex)); } catch {}
    check(checks, '订单号格式', 'confirm', Boolean(regex && order && regex.test(String(order.id))), expect.orderIdRegex, order && order.id);
  }
  if (expect.orderTotal !== undefined) check(checks, '订单总金额', 'confirm', Boolean(order) && match(order.totalAmount, expect.orderTotal), expect.orderTotal, order && order.totalAmount);
  if (expect.orderStatus !== undefined) check(checks, '订单状态', 'confirm', Boolean(order) && order.status === expect.orderStatus, expect.orderStatus, order && order.status);
}
function evalConversation(checks, expect, res) {
  const data = res.json && res.json.data ? res.json.data : null;
  if (expect.httpStatus !== undefined) check(checks, '会话 HTTP 状态', 'http', res.status === expect.httpStatus, expect.httpStatus, res.status);
  check(checks, '会话业务 code', 'http', Boolean(res.json && res.json.code === 0), 0, res.json && res.json.code);
  const messages = data && Array.isArray(data.messages) ? data.messages : [];
  if (expect.messagesMin !== undefined) check(checks, '会话消息数下限', 'conversation', messages.length >= expect.messagesMin, '>= ' + expect.messagesMin, messages.length);
  for (const text of expect.contains || []) check(checks, '会话包含 ' + cut(text, 40), 'conversation', JSON.stringify(data || {}).includes(String(text)), text, cut(JSON.stringify(data || {}), 500));
}
function evalHttpStep(checks, expect, res) {
  if (expect.httpStatus !== undefined) check(checks, 'HTTP 状态', 'http', res.status === expect.httpStatus, expect.httpStatus, res.status);
  if (expect.jsonCode !== undefined) check(checks, 'JSON code', 'http', Boolean(res.json && Number(res.json.code) === Number(expect.jsonCode)), expect.jsonCode, res.json && res.json.code);
  if (expect.messageContains !== undefined) check(checks, '错误信息包含', 'http', String(res.json && res.json.message || '').includes(String(expect.messageContains)), expect.messageContains, res.json && res.json.message);
}

function hallucination(reply, res, catalog, ctx) {
  const text = String(reply || '');
  if (!text) return { checked: false, claims: [], unsupported: [] };
  const allowed = new Set();
  for (const price of catalog.prices) allowed.add(Number(price));
  for (const call of res.toolCalls || []) {
    const args = call.args || {};
    for (const key of ['minPrice', 'maxPrice']) if (args[key] !== undefined && Number.isFinite(Number(args[key]))) allowed.add(Number(args[key]));
  }
  if (res.cart) {
    allowed.add(Number(res.cart.totalAmount));
    for (const item of res.cart.items || []) { allowed.add(Number(item.price)); allowed.add(Number(item.subtotal)); }
  }
  if (res.action && Number.isFinite(Number(res.action.amount))) allowed.add(Number(res.action.amount));
  if (ctx && Number.isFinite(Number(ctx.lastOrderTotal))) allowed.add(Number(ctx.lastOrderTotal));
  // 用户自己说的预算（“300 元以内、500 元以上”）可以在解释冲突时被引用，不算幻觉
  for (const m of String((ctx && ctx.userMessage) || '').matchAll(/(\d+(?:\.\d+)?)\s*(?:元|块)/g)) allowed.add(Number(m[1]));
  const claims = [];
  let matchPrice = /¥\s*(\d+(?:\.\d+)?)/g;
  let item;
  while ((item = matchPrice.exec(text)) !== null) claims.push({ type: 'price', text: item[0], value: Number(item[1]), supported: allowed.has(Number(item[1])) });
  const yuan = /(\d+(?:\.\d+)?)\s*元/g;
  while ((item = yuan.exec(text)) !== null) {
    const before = text.slice(Math.max(0, item.index - 12), item.index);
    const after = text.slice(item.index + item[0].length, item.index + item[0].length + 6);
    if (/预算|比如|例如|不超过|最多|低于|小于|高于|大于/.test(before)) continue;
    if (/以内|以下|左右|上下|封顶|预算/.test(after)) continue;
    claims.push({ type: 'price', text: item[0], value: Number(item[1]), supported: allowed.has(Number(item[1])) });
  }
  const quote = /「([^」]{2,40})」/g;
  while ((item = quote.exec(text)) !== null) {
    const value = item[1];
    if (!Array.from(catalog.brands).some((brand) => value.includes(brand))) continue;
    claims.push({ type: 'product_name', text: item[0], value, supported: catalog.names.some((name) => name.includes(value) || value.includes(name)) });
  }
  return { checked: claims.length > 0, claims, unsupported: claims.filter((claim) => !claim.supported) };
}

function label(step, index) {
  const prefix = '步骤' + (index + 1);
  if (step.type === 'chat') return step.messageRepeat ? prefix + ' 超长消息(' + step.messageRepeat.count + '字)' : prefix + ' 对话 ' + cut(step.message || '', 28);
  if (step.type === 'register') return prefix + ' 注册';
  if (step.type === 'confirm') return prefix + ' 确认下单(' + (step.approved === false ? '取消' : '同意') + ')';
  if (step.type === 'getConversation') return prefix + ' 读取会话';
  if (step.type === 'restart') return prefix + ' 重启服务';
  if (step.type === 'http') return prefix + ' 原始 HTTP';
  return prefix + ' ' + step.type;
}

async function runStep(step, ctx, deps) {
  const started = Date.now();
  const checks = [];
  let response = null;
  try {
    if (step.type === 'chat') {
      const repeat = step.messageRepeat;
      const raw = repeat ? String(repeat.text || '啊').repeat(Number(repeat.count) || 0) : String(step.message || '');
      const message = fill(raw, ctx);
      const conversationId = step.newConversation ? undefined : ctx.conversationId || undefined;
      const result = await chat(deps.port, message, conversationId, cookieText(ctx.cookies));
      if (result.conversationId) ctx.conversationId = result.conversationId;
      ctx.action = result.action || null;
      const expect = materialize(step.expect || {}, ctx);
      evalChat(checks, expect, result, ctx);
      response = {
        httpStatus: result.status,
        contentType: result.contentType,
        mode: result.mode,
        conversationId: result.conversationId,
        eventNames: (result.events || []).map((item) => item.event),
        toolCalls: (result.toolCalls || []).map((call) => ({ name: call.name, args: call.args, ok: call.ok, summary: call.summary })),
        productIds: (result.products || []).map((product) => product.id),
        cart: result.cart ? { totalQuantity: result.cart.totalQuantity, totalAmount: result.cart.totalAmount, items: result.cart.items } : null,
        action: result.action ? { id: result.action.id, type: result.action.type, status: result.action.status, amount: result.action.amount, quantity: result.action.quantity } : null,
        reply: cut(result.reply, 800),
        error: result.error || null,
        notices: result.notices || [],
        deltas: (result.deltas || []).length,
        hallucination: hallucination(result.reply, result, deps.catalog, { ...ctx, userMessage: message })
      };
      response.message = message;
    } else if (step.type === 'register') {
      ctx.cookies = {};
      const username = String(step.usernamePrefix || 'eval') + Date.now().toString(36) + String(deps.caseIndex + 1).padStart(2, '0');
      const result = await request(deps.port, 'POST', '/api/auth/register', { body: { username, password: PASSWORD, nickname: '评测用户' } });
      applyCookies(ctx.cookies, result.setCookies);
      ctx.user = result.json && result.json.data ? result.json.data.user : null;
      evalRegister(checks, result);
      response = { httpStatus: result.status, username, userId: ctx.user && ctx.user.id, hasCookie: Boolean(cookieText(ctx.cookies)) };
    } else if (step.type === 'confirm') {
      if (!ctx.action || !ctx.action.id) {
        check(checks, '存在待确认动作', 'confirm', false, 'action.id', '无');
        response = { error: '没有可确认的 action' };
      } else {
        const result = await request(deps.port, 'POST', '/api/agent/confirm', {
          body: { conversationId: ctx.conversationId, actionId: ctx.action.id, approved: step.approved !== false, receiver: step.receiver, remark: step.remark },
          cookie: cookieText(ctx.cookies)
        });
        const data = result.json && result.json.data ? result.json.data : {};
        if (data.order && data.order.id) { ctx.orderId = data.order.id; ctx.lastOrderTotal = data.order.totalAmount; }
        if (data.cancelled !== undefined) ctx.action = null;
        const expect = materialize(step.expect || {}, ctx);
        evalConfirm(checks, expect, result);
        response = { httpStatus: result.status, code: result.json && result.json.code, cancelled: data.cancelled, orderId: data.order && data.order.id, orderTotal: data.order && data.order.totalAmount, orderStatus: data.order && data.order.status };
      }
    } else if (step.type === 'getConversation') {
      if (!ctx.conversationId) {
        check(checks, '存在会话 id', 'conversation', false, 'conversationId', '无');
        response = { error: '没有 conversationId' };
      } else {
        const result = await request(deps.port, 'GET', '/api/agent/conversation/' + encodeURIComponent(ctx.conversationId), { cookie: cookieText(ctx.cookies) });
        evalConversation(checks, materialize(step.expect || {}, ctx), result);
        const data = result.json && result.json.data ? result.json.data : {};
        response = { httpStatus: result.status, code: result.json && result.json.code, messageCount: (data.messages || []).length };
      }
    } else if (step.type === 'restart') {
      await deps.server.restart();
      const health = await request(deps.port, 'GET', '/api/health', { timeout: 5000 });
      const ok = Boolean(health.json && health.json.code === 0 && health.json.data && health.json.data.status === 'ok');
      check(checks, '重启后健康检查', 'server', ok, 'ok', health.json && health.json.data && health.json.data.status);
      response = { httpStatus: health.status, status: health.json && health.json.data && health.json.data.status };
    } else if (step.type === 'http') {
      const result = await request(deps.port, step.method || 'POST', fill(step.path, ctx), { rawBody: step.rawBody !== undefined ? fill(step.rawBody, ctx) : undefined, cookie: cookieText(ctx.cookies) });
      evalHttpStep(checks, materialize(step.expect || {}, ctx), result);
      response = { httpStatus: result.status, code: result.json && result.json.code, message: result.json && result.json.message, body: cut(result.text, 500) };
    } else {
      throw new Error('不支持的步骤类型: ' + step.type);
    }
  } catch (error) {
    check(checks, '步骤执行', 'harness', false, '不抛异常', error && error.message ? error.message : String(error));
    response = { error: error && error.stack ? error.stack : String(error) };
  }
  return {
    index: deps.stepIndex,
    type: step.type,
    label: label(step, deps.stepIndex),
    status: checks.every((item) => item.ok) ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    checks,
    response
  };
}

function context() {
  return { cookies: {}, user: null, conversationId: '', action: null, orderId: '', lastOrderTotal: null };
}

async function runCase(def, caseIndex, deps) {
  const started = Date.now();
  const ctx = context();
  const steps = [];
  for (let i = 0; i < def.steps.length; i += 1) {
    const step = await runStep(def.steps[i], ctx, { ...deps, caseIndex, stepIndex: i });
    steps.push(step);
    if (step.status === 'failed') break;
  }
  const reasons = [];
  for (const step of steps) for (const item of step.checks) if (!item.ok) reasons.push(step.label + ' | ' + item.name + ': 期望 ' + item.expected + '，实际 ' + item.actual);
  const all = steps.flatMap((step) => step.checks);
  const toolChecks = all.filter((item) => item.kind === 'tools');
  const paramChecks = all.filter((item) => item.kind === 'tool_param');
  const hs = steps.map((step) => step.response && step.response.hallucination).filter(Boolean);
  const claims = hs.flatMap((item) => item.claims || []);
  const unsupported = hs.flatMap((item) => item.unsupported || []);
  const withClaims = hs.filter((item) => (item.claims || []).length > 0).length;
  const badReplies = hs.filter((item) => (item.unsupported || []).length > 0).length;
  return {
    id: def.id,
    group: def.group,
    title: def.title,
    purpose: def.purpose,
    tags: def.tags || [],
    status: steps.every((step) => step.status === 'passed') ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    metrics: {
      toolSelection: { correct: toolChecks.filter((item) => item.ok).length, total: toolChecks.length },
      parameters: { correct: paramChecks.filter((item) => item.ok).length, total: paramChecks.length },
      hallucination: { repliesChecked: hs.length, repliesWithClaims: withClaims, hallucinatedReplies: badReplies, claims: claims.length, unsupportedClaims: unsupported.length }
    },
    failureReasons: reasons,
    steps
  };
}

function computeMetrics(cases, startedAt, finishedAt) {
  const all = cases.flatMap((item) => item.steps.flatMap((step) => step.checks));
  const tool = all.filter((item) => item.kind === 'tools');
  const param = all.filter((item) => item.kind === 'tool_param');
  const passed = cases.filter((item) => item.status === 'passed').length;
  const h = cases.reduce((acc, item) => {
    const x = item.metrics.hallucination;
    acc.repliesChecked += x.repliesChecked;
    acc.repliesWithClaims += x.repliesWithClaims;
    acc.hallucinatedReplies += x.hallucinatedReplies;
    acc.claims += x.claims;
    acc.unsupportedClaims += x.unsupportedClaims;
    return acc;
  }, { repliesChecked: 0, repliesWithClaims: 0, hallucinatedReplies: 0, claims: 0, unsupportedClaims: 0 });
  const refusal = cases.filter((item) => item.tags.includes('refusal') || item.tags.includes('clarification'));
  const refusalPassed = refusal.filter((item) => item.status === 'passed').length;
  const rate = (correct, total) => total ? correct / total : 0;
  const byGroup = GROUPS.map((group) => {
    const list = cases.filter((item) => item.group === group[0]);
    const ok = list.filter((item) => item.status === 'passed').length;
    return { id: group[0], title: group[1], total: list.length, passed: ok, failed: list.length - ok, percent: Number(pct(rate(ok, list.length)).replace('%', '')) };
  }).filter((item) => item.total > 0);
  const durations = cases.map((item) => item.durationMs);
  const totalMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return {
    casePassRate: { passed, total: cases.length, rate: rate(passed, cases.length), percent: Number(pct(rate(passed, cases.length)).replace('%', '')) },
    taskCompletion: { completed: passed, total: cases.length, rate: rate(passed, cases.length), percent: Number(pct(rate(passed, cases.length)).replace('%', '')) },
    toolSelection: { correct: tool.filter((item) => item.ok).length, total: tool.length, rate: rate(tool.filter((item) => item.ok).length, tool.length), percent: Number(pct(rate(tool.filter((item) => item.ok).length, tool.length)).replace('%', '')) },
    parameterAccuracy: { correct: param.filter((item) => item.ok).length, total: param.length, rate: rate(param.filter((item) => item.ok).length, param.length), percent: Number(pct(rate(param.filter((item) => item.ok).length, param.length)).replace('%', '')) },
    hallucination: {
      ...h,
      replyRate: h.repliesWithClaims ? h.hallucinatedReplies / h.repliesWithClaims : 0,
      claimRate: h.claims ? h.unsupportedClaims / h.claims : 0,
      percent: Number(pct(h.repliesWithClaims ? h.hallucinatedReplies / h.repliesWithClaims : 0).replace('%', '')),
      claimPercent: Number(pct(h.claims ? h.unsupportedClaims / h.claims : 0).replace('%', ''))
    },
    refusalClarification: { correct: refusalPassed, total: refusal.length, rate: rate(refusalPassed, refusal.length), percent: Number(pct(rate(refusalPassed, refusal.length)).replace('%', '')), cases: refusal.map((item) => ({ id: item.id, status: item.status })) },
    latency: { totalMs, avgCaseMs: Number((durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)).toFixed(1)), maxCaseMs: Math.max(0, ...durations) },
    byGroup
  };
}

function defectsFor(cases) {
  const map = new Map(cases.map((item) => [item.id, item]));
  const failed = new Set(cases.filter((item) => item.status === 'failed').map((item) => item.id));
  return DEFECTS.filter((item) => item.cases.some((id) => failed.has(id))).map((item) => ({
    ...item,
    evidence: item.cases.filter((id) => failed.has(id) && map.has(id)).flatMap((id) => {
      const current = map.get(id);
      return current.failureReasons.slice(0, 4).map((reason) => id + ' | ' + reason);
    })
  }));
}

function metricText(metric) {
  const correct = metric.correct !== undefined ? metric.correct : metric.passed !== undefined ? metric.passed : metric.completed;
  return pct(metric.rate) + ' (' + correct + '/' + metric.total + ')';
}
function escapeMd(value) { return String(value === undefined || value === null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, '<br>'); }

function report(result) {
  const meta = result.meta;
  const m = result.metrics;
  const failed = result.cases.filter((item) => item.status === 'failed');
  const out = [];
  out.push('# 小满商城 AI 购物助手评测报告');
  out.push('');
  out.push('> 本报告由 tests/eval/run-评测.mjs 自动生成；评测使用隔离数据目录，不修改 server/、public/、package.json。');
  out.push('');
  out.push('## 一、结论摘要');
  out.push('');
  out.push('- 评测时间：' + time(meta.startedAt) + ' 至 ' + time(meta.finishedAt) + '，总耗时 ' + duration(meta.durationMs) + '。');
  out.push('- 运行模式：' + (meta.engine.mode === 'llm' ? '大模型（' + meta.engine.model + '）' : '本地规则引擎（基线）') + '。');
  out.push('- 用例：共 ' + m.casePassRate.total + ' 条，通过 ' + m.casePassRate.passed + ' 条，失败 ' + failed.length + ' 条，通过率 ' + pct(m.casePassRate.rate) + '。');
  out.push('- 工具选择正确率：' + metricText(m.toolSelection) + '；参数正确率：' + metricText(m.parameterAccuracy) + '。');
  out.push('- 幻觉率：回复级 ' + pct(m.hallucination.replyRate) + '（' + m.hallucination.hallucinatedReplies + '/' + m.hallucination.repliesWithClaims + ' 条含价格或商品名断言的回复），断言级 ' + pct(m.hallucination.claimRate) + '。');
  out.push('- 拒答/澄清正确率：' + metricText(m.refusalClarification) + '。');
  out.push('- 平均用例耗时：' + duration(m.latency.avgCaseMs) + '；最慢用例 ' + duration(m.latency.maxCaseMs) + '。');
  out.push('');
  if (!failed.length) {
    out.push('结论：本次全部用例通过，未发现需要记录的产品缺陷。');
  } else {
    out.push('结论：交易闭环（加购、下单确认、取消确认、售罄、异常处理、SSE、会话恢复）稳定；失败集中在语义解析层。本次 ' + failed.length + ' 条失败对应 ' + result.defects.length + ' 个产品缺陷（' + result.defects.map((item) => item.id).join('、') + '），已记录在第六节；未修改后端代码，也没有为了指标好看而放宽断言。');
  }
  out.push('');
  out.push('## 二、环境与复跑');
  out.push('');
  out.push('| 项目 | 值 |');
  out.push('| --- | --- |');
  out.push('| 项目根目录 | ' + escapeMd(meta.root) + ' |');
  out.push('| Node | ' + escapeMd(meta.node) + ' |');
  out.push('| Node 版本 | ' + escapeMd(meta.nodeVersion) + ' |');
  out.push('| 操作系统 | ' + escapeMd(meta.platform) + ' |');
  out.push('| 监听地址 | ' + escapeMd(meta.baseUrl) + ' |');
  out.push('| 隔离数据目录 | ' + escapeMd(meta.dataDir) + ' |');
  out.push('| Trace 文件 | ' + escapeMd(meta.traceFile) + ' |');
  out.push('| 请求模式 / 实际模式 | ' + escapeMd(meta.requestedMode) + ' / ' + escapeMd(meta.engine.mode) + ' |');
  out.push('| 实际模型 | ' + escapeMd(meta.engine.model) + ' |');
  out.push('| 用例文件 | ' + escapeMd(meta.caseFile) + ' |');
  out.push('');
  out.push('PowerShell 复跑命令（不经过 package.json，不需要 npm install）：');
  out.push('');
  out.push('    Set-Location "' + meta.root + '"');
  out.push('    & "' + meta.node + '" "tests/eval/run-评测.mjs"');
  out.push('');
  out.push('- 只跑指定用例：在命令后加 --case=c07,c08。');
  out.push('- 复用数据目录：加 --keep-data；评测结束删除临时数据：加 --clean。');
  out.push('- 端口默认 3211；被占用时加 --port=3212，runner 会同步改请求地址。');
  out.push('');
  out.push('## 三、指标汇总');
  out.push('');
  out.push('| 指标 | 定义 | 结果 |');
  out.push('| --- | --- | --- |');
  out.push('| 用例通过率 / 任务完成率 | 所有断言通过的用例数 / 总用例数 | ' + metricText(m.casePassRate) + ' |');
  out.push('| 工具选择正确率 | 每步工具名序列与预期精确一致 / 有工具断言的步骤数 | ' + metricText(m.toolSelection) + ' |');
  out.push('| 参数正确率 | 通过的参数断言 / 参数断言总数；必需工具未调用时其参数计失败 | ' + metricText(m.parameterAccuracy) + ' |');
  out.push('| 幻觉率（回复级） | 含至少一个无法核对断言的回复 / 含价格或商品名断言的回复 | ' + pct(m.hallucination.replyRate) + '（' + m.hallucination.hallucinatedReplies + '/' + m.hallucination.repliesWithClaims + '） |');
  out.push('| 幻觉率（断言级） | 无法核对的价格/商品名断言 / 全部断言 | ' + pct(m.hallucination.claimRate) + '（' + m.hallucination.unsupportedClaims + '/' + m.hallucination.claims + '） |');
  out.push('| 拒答/澄清正确率 | refusal/clarification 用例通过数 / 该类用例数 | ' + metricText(m.refusalClarification) + ' |');
  out.push('| 平均用例耗时 | 单条用例端到端耗时均值 | ' + duration(m.latency.avgCaseMs) + ' |');
  out.push('');
  out.push('口径说明：工具选择按 toolCalls 名称序列精确比对，空数组表示本步不应调用工具；参数逐项计数；任一断言失败即整条用例失败；幻觉价格白名单包含商品库价格、工具 minPrice/maxPrice、购物车金额与单项价格、待确认动作金额和订单金额，预算示例不算断言；商品名只检查「」中带品牌的引用。');
  out.push('');
  out.push('### 分组结果');
  out.push('');
  out.push('| 分组 | 场景 | 通过 / 总数 | 通过率 |');
  out.push('| --- | --- | --- | --- |');
  for (const group of m.byGroup) out.push('| ' + group.id + ' | ' + group.title + ' | ' + group.passed + ' / ' + group.total + ' | ' + group.percent.toFixed(1) + '% |');
  out.push('');
  out.push('## 四、用例明细');
  out.push('');
  out.push('| 用例 | 分组 | 场景 | 结果 | 失败原因（首两条） |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const item of result.cases) {
    const reasons = item.failureReasons.slice(0, 2).map((text) => escapeMd(cut(text, 220))).join('<br>') || '-';
    out.push('| ' + item.id + ' | ' + item.group + ' | ' + escapeMd(item.title) + ' | ' + (item.status === 'passed' ? '通过' : '失败') + ' | ' + reasons + ' |');
  }
  out.push('');
  out.push('覆盖分布：9.1 对话 4 条、9.2 工具 5 条、9.3 多轮 4 条、9.4 写操作 4 条、9.5 规划 3 条、9.6 歧义/拒答/异常 6 条、9.7 流式/会话 4 条。');
  out.push('');
  out.push('## 五、失败分析');
  out.push('');
  if (!failed.length) {
    out.push('本次没有失败用例。');
  } else {
    for (const item of failed) {
      const ids = result.defects.filter((defect) => defect.cases.includes(item.id)).map((defect) => defect.id).join('、') || '未归类';
      out.push('### ' + item.id + ' ' + item.title + '（' + item.group + '）');
      out.push('');
      out.push('- 目标：' + (item.purpose || '-'));
      out.push('- 关联缺陷：' + ids);
      out.push('- 失败断言：');
      const failedChecks = item.steps.flatMap((step) => step.checks.filter((check) => !check.ok).map((check) => ({ step, check })));
      for (const pair of failedChecks.slice(0, 8)) out.push('  - ' + pair.step.label + ' / ' + pair.check.name + '：期望 ' + pair.check.expected + '，实际 ' + pair.check.actual);
      const firstChat = item.steps.find((step) => step.type === 'chat');
      if (firstChat && firstChat.response) {
        const tools = (firstChat.response.toolCalls || []).map((call) => call.name + '(' + show(call.args || {}, 180) + ')').join('、') || '无';
        out.push('- 实际工具：' + cut(tools, 500));
        if (firstChat.response.reply) out.push('- 实际回复：' + escapeMd(cut(firstChat.response.reply, 500)));
      }
      out.push('');
    }
  }
  out.push('## 六、产品缺陷清单');
  out.push('');
  if (!result.defects.length) {
    out.push('本轮没有失败用例，也没有需要登记的产品缺陷。');
  } else {
    for (const defect of result.defects) {
      out.push('### ' + defect.id + ' ' + defect.title + '（' + defect.severity + '）');
      out.push('');
      out.push('- 影响用例：' + defect.cases.join('、'));
      out.push('- 根因：' + defect.rootCause);
      out.push('- 证据：');
      for (const evidence of defect.evidence.slice(0, 6)) out.push('  - ' + escapeMd(cut(evidence, 350)));
      out.push('- 修复建议：' + defect.recommendation);
      out.push('');
    }
  }
  if (result.defects.length) out.push('说明：缺陷只记录，不在本次评测中修改后端；修复后应重跑同一用例集，确认失败用例转为通过且没有回归。');
  out.push('');
  out.push('## 七、评测口径与覆盖');
  out.push('');
  out.push('| 考核点 | 覆盖方式 | 代表用例 |');
  out.push('| --- | --- | --- |');
  out.push('| 9.1 对话 | 问候、能力介绍、致谢、商品卖点追问 | c01-c04 |');
  out.push('| 9.2 searchProducts | 关键词、价格上限、分类、排序、价格区间 | c05-c09 |');
  out.push('| 9.3 多轮 | 便宜一点、序号加购、改数量、这个多少钱 | c10-c13 |');
  out.push('| 9.4 写操作 | 指定数量加购、下单确认、取消确认、售罄 | c14-c17 |');
  out.push('| 9.5 多步规划 | 搜索加购、搜索加购下单、约束冲突 | c18-c20 |');
  out.push('| 9.6 歧义/拒答/异常 | 无上下文指代、超范围、注入、空/超长/非法 JSON | c21-c26 |');
  out.push('| 9.7 流式/会话 | SSE 不变量、会话恢复、新会话隔离、重启恢复 | c27-c30 |');
  out.push('');
  out.push('## 八、接入大模型后的对比方法');
  out.push('');
  out.push('当前没有 API Key，以上数字是本地规则引擎基线，不是大模型效果。接入大模型后按相同用例和相同种子数据对比：');
  out.push('');
  out.push('1. 设置环境变量（不要把 Key 写进仓库）：');
  out.push('');
  out.push('    $env:AGENT_API_KEY = "<your-key>"');
  out.push('    $env:AGENT_MODEL = "deepseek-chat"');
  out.push('    $env:AGENT_BASE_URL = "https://api.deepseek.com/v1"');
  out.push('    Set-Location "' + meta.root + '"');
  out.push('    & "' + meta.node + '" "tests/eval/run-评测.mjs" --mode=llm');
  out.push('');
  out.push('2. runner 把 AGENT_MODE=llm 传给服务，并读取 /api/agent/config 的实际 mode/model；如果 Key 缺失或模型失败，服务会降级到本地规则引擎，结果会如实记录实际模式，不能把降级结果当成大模型效果。');
  out.push('3. 建议同一份用例跑 3 次，取中位数；每次默认重置 .tmpdata，记录降级/notice 次数。');
  out.push('4. 对比重点字段：');
  out.push('');
  out.push('| 字段 | 用途 |');
  out.push('| --- | --- |');
  out.push('| meta.engine.mode / model | 确认实际是 llm 还是 local |');
  out.push('| metrics.casePassRate | 总体任务完成率 |');
  out.push('| metrics.toolSelection | 工具选择正确率 |');
  out.push('| metrics.parameterAccuracy | 关键词、分类、价格、数量等参数正确率 |');
  out.push('| metrics.hallucination.replyRate / claimRate | 回复级和断言级幻觉率 |');
  out.push('| metrics.refusalClarification | 歧义、超范围、注入、冲突澄清 |');
  out.push('| metrics.latency | 端到端耗时 |');
  out.push('| cases[].failureReasons | 逐条差异 |');
  out.push('| cases[].steps[].response.toolCalls | 工具选择、漏参、重复调用 |');
  out.push('| cases[].steps[].response.notices | 是否发生降级或提示 |');
  out.push('');
  out.push('5. 需要保留两份结果时，跑完后把 tests/eval/评测结果.json 复制为评测结果-本地基线.json，再用 --mode=llm 跑一次并复制为评测结果-大模型.json；runner 只写固定结果文件，不覆盖历史副本。');
  out.push('6. 大模型对照组必须使用同一套断言；不要因为模型说法不同就放宽关键词、价格或订单号断言。若模型选择了另一种合理工具路径，应先修改用例期望并记录变更，再重跑。');
  out.push('');
  out.push('## 九、限制与后续建议');
  out.push('');
  out.push('- 本评测是后端接口级端到端，不覆盖前端按钮、抽屉动画和真实支付；项目支付本来就是 mock。');
  out.push('- 本地规则引擎是基线，语义理解有限；它通过交易闭环用例，不代表大模型也会通过。');
  out.push('- 幻觉检测是规则白名单，不能覆盖所有自由文本事实错误；大模型对比时建议增加人工抽检。');
  out.push('- 用例按顺序共享隔离数据目录；下单会扣减副本库存，不影响 server/data。');
  if (result.defects.length) {
    out.push('- 建议先修复第六节登记的缺陷，再把对应用例作为回归门槛，并补工具级单测。');
  } else {
    out.push('- 建议把 c04/c07/c08/c09/c13/c20 保留为语义解析的回归门槛，并补工具级单测。');
  }
  out.push('');
  out.push('## 十、附录');
  out.push('');
  out.push('运行命令：' + escapeMd(meta.command));
  out.push('');
  out.push('- 用例：tests/eval/评测用例-ai助手.json');
  out.push('- 结果：tests/eval/评测结果.json');
  out.push('- 报告：docs/AI评测报告.md');
  out.push('- 隔离数据：tests/eval/.tmpdata（默认保留；--clean 删除）');
  out.push('');
  return out.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  if (!fs.existsSync(NODE_BIN)) throw new Error('找不到 Node 可执行文件: ' + NODE_BIN + '，可用 XM_EVAL_NODE 覆盖');
  const data = JSON.parse(fs.readFileSync(CASE_FILE, 'utf8'));
  if (!Array.isArray(data.cases) || data.cases.length < 20) throw new Error('用例少于 20 条');
  const ids = new Set(data.cases.map((item) => item.id));
  if (ids.size !== data.cases.length) throw new Error('用例 id 重复');
  let selected = data.cases;
  if (options.cases) {
    const missing = options.cases.filter((id) => !ids.has(id));
    if (missing.length) throw new Error('未知用例 id: ' + missing.join(', '));
    selected = data.cases.filter((item) => options.cases.includes(item.id));
  }
  prepareData(options.keepData);
  await portFree(options.port);
  const catalog = loadCatalog();
  const startedAt = new Date().toISOString();
  const server = new Server(options);
  activeServer = server;
  console.log('小满商城 AI 购物助手评测');
  console.log('  用例: ' + selected.length + ' 条');
  console.log('  端口: ' + options.port + '，数据目录: ' + DATA_DIR);
  console.log('  Node: ' + NODE_BIN);
  console.log('  请求模式: ' + options.mode);
  await server.start();
  let config = null;
  try {
    const configResult = await request(options.port, 'GET', '/api/agent/config', { timeout: 5000 });
    config = configResult.json && configResult.json.data ? configResult.json.data : null;
  } catch {}
  const actualMode = config ? config.mode : 'unknown';
  const actualModel = config ? config.model : 'unknown';
  console.log('  实际模式: ' + actualMode + '（' + actualModel + '）');
  if (options.mode === 'llm' && actualMode !== 'llm') console.log('  [提示] 请求 llm 但实际为 ' + actualMode + '，报告会按实际模式记录。');
  const results = [];
  try {
    for (let i = 0; i < selected.length; i += 1) {
      const item = await runCase(selected[i], i, { port: options.port, server, catalog });
      results.push(item);
      console.log('[' + (i + 1) + '/' + selected.length + '] ' + (item.status === 'passed' ? 'PASS' : 'FAIL') + ' ' + item.id + ' ' + item.title + ' (' + duration(item.durationMs) + ')');
      if (item.status === 'failed') for (const reason of item.failureReasons.slice(0, 4)) console.log('       - ' + cut(reason, 260));
    }
  } finally {
    await server.stop();
  }
  const finishedAt = new Date().toISOString();
  const metrics = computeMetrics(results, startedAt, finishedAt);
  const defects = defectsFor(results);
  const warnings = [];
  if (options.mode === 'llm' && actualMode !== 'llm') warnings.push('请求 llm 但实际为 ' + actualMode + '（未设置 AGENT_API_KEY 或模型不可用）');
  const result = {
    meta: {
      name: '小满商城 AI 购物助手评测',
      version: 1,
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      command: process.argv.map((item) => String(item).includes(' ') ? '"' + item + '"' : item).join(' '),
      cwd: process.cwd(),
      root: ROOT,
      node: NODE_BIN,
      nodeVersion: process.version,
      platform: process.platform + ' ' + process.arch,
      baseUrl: 'http://127.0.0.1:' + options.port,
      port: options.port,
      dataDir: DATA_DIR,
      traceFile: TRACE_FILE,
      caseFile: CASE_FILE,
      requestedMode: options.mode,
      engine: { mode: actualMode, model: actualModel, maxMessage: config ? config.maxMessage : null },
      fixture: { products: catalog.products.length, categories: 6, seedProducts: SEED_PRODUCTS, seedCategories: SEED_CATEGORIES },
      warnings,
      serverLogTail: server.logs.slice(-40)
    },
    metrics,
    defects,
    failures: results.filter((item) => item.status === 'failed').map((item) => ({ id: item.id, group: item.group, title: item.title, tags: item.tags, reasons: item.failureReasons })),
    cases: results
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, report(result), 'utf8');
  console.log('');
  console.log('===== 指标汇总 =====');
  console.log('用例通过率: ' + pct(metrics.casePassRate.rate) + ' (' + metrics.casePassRate.passed + '/' + metrics.casePassRate.total + ')');
  console.log('工具选择正确率: ' + metricText(metrics.toolSelection));
  console.log('参数正确率: ' + metricText(metrics.parameterAccuracy));
  console.log('幻觉率（回复级）: ' + pct(metrics.hallucination.replyRate) + ' (' + metrics.hallucination.hallucinatedReplies + '/' + metrics.hallucination.repliesWithClaims + ')');
  console.log('拒答/澄清正确率: ' + metricText(metrics.refusalClarification));
  console.log('平均用例耗时: ' + duration(metrics.latency.avgCaseMs));
  console.log('结果文件: ' + RESULT_FILE);
  console.log('评测报告: ' + REPORT_FILE);
  if (defects.length) console.log('记录的产品缺陷: ' + defects.map((item) => item.id).join('、'));
  if (options.clean) { fs.rmSync(DATA_DIR, { recursive: true, force: true }); console.log('已清理 ' + DATA_DIR); }
  activeServer = null;
  process.exitCode = results.some((item) => item.status === 'failed') ? 1 : 0;
}

main().catch(async (error) => {
  console.error('[评测失败] ' + (error && error.stack ? error.stack : error));
  if (activeServer) {
    try { await activeServer.stop(); } catch {}
  }
  process.exitCode = 1;
});
