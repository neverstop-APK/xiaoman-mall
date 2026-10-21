/**
 * 【文件作用】购物助手编排层：一次对话从进来到出去，都经过这里
 * ------------------------------------------------------------
 * 它负责四件事：
 *   1. 选模式：配了 AGENT_API_KEY 就用大模型，没配就用本地规则引擎；
 *      大模型调用失败时自动降级，保证演示不中断。
 *   2. 管会话：取会话、存用户消息、存助手回复和商品卡片。
 *   3. 收集 Trace：本轮调了哪些工具、参数是什么、成功没有、各花多久。
 *   4. 处理"确认下单"：用户点确认之前，绝不真正创建订单。
 *
 * 【对应知识点】分层、依赖注入、降级策略、错误处理
 * 【对应考核点】9.1–9.8
 */
const fs = require('node:fs');
const path = require('node:path');
const conversationStore = require('./conversation-会话存储');
const localBrain = require('./localbrain-本地规则引擎');
const llm = require('./llm-大模型适配器');
const tools = require('./tools-工具集');
const orderService = require('../services/orders-订单服务');
const { HttpError } = require('../lib/response-统一响应格式');

const MAX_MESSAGE = 500;
const TRACE_FILE =
  process.env.XM_TRACE_FILE ||
  path.join(process.env.XM_DATA_DIR ? path.resolve(process.env.XM_DATA_DIR) : path.join(__dirname, '..', 'data'), 'agent-traces.jsonl');

function mode() {
  return llm.config().enabled ? 'llm' : 'local';
}

function assertMessage(message) {
  const text = String(message || '').replace(/\s+$/g, '').trim();
  if (!text) throw new HttpError(400, 40031, '消息不能为空');
  if (text.length > MAX_MESSAGE) throw new HttpError(400, 40032, '消息太长了，请控制在 ' + MAX_MESSAGE + ' 字以内');
  return text;
}

/** 商品卡片只存画卡片需要的字段，别把整条商品数据写进会话文件 */
function compactCards(products) {
  return (products || []).slice(0, 6).map((item) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    price: item.price,
    originalPrice: item.originalPrice || null,
    emoji: item.emoji,
    cover: item.cover || '',
    summary: item.summary,
    category: item.category,
    stock: item.stock
  }));
}

function writeTrace(record) {
  try {
    fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
    fs.appendFileSync(TRACE_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('[Trace 写入失败]', err.message);
  }
}

/**
 * 跑一轮对话。
 * emit(type, payload) 由路由层提供，负责把事件写成 SSE。
 */
async function chat({ conversationId, message, cartId, user, emit }) {
  const text = assertMessage(message);
  const conversation = conversationStore.getOrCreate(conversationId, { userId: user ? user.id : null, cartId: cartId || '' });
  // 会话归属校验：登录用户的会话不能被另一个账号接着聊
  if (conversation.userId && (!user || user.id !== conversation.userId)) {
    throw new HttpError(403, 40330, '这个会话不属于当前账号，请新开一段对话');
  }
  if (user && !conversation.userId) conversation.userId = user.id;
  if (cartId) conversation.cartId = cartId;

  conversationStore.append(conversation, { role: 'user', content: text });

  const trace = [];
  const startedAt = Date.now();
  let currentMode = mode();
  let emitted = false;
  let result = null;
  let fallbackReason = '';

  const safeEmit = (type, payload) => {
    if (type === 'delta') emitted = true;
    emit(type, payload);
  };

  emit('meta', { conversationId: conversation.id, mode: currentMode, cartId: conversation.cartId });

  try {
    result = await tools.withTrace(trace, () =>
      currentMode === 'llm'
        ? llm.run({ conversation, message: text, emit: safeEmit, user, tools })
        : localBrain.run({ conversation, message: text, emit: safeEmit, user })
    );
  } catch (err) {
    fallbackReason = err.message || '模型调用失败';
    console.error('[Agent 大模型失败]', fallbackReason);
    if (emitted) {
      // 已经流出去一部分内容了，不能再来一遍，只能补一句说明
      result = {
        reply: '\n\n（模型连接中断了，上面的内容可能不完整。可以再问一次，或稍后再试。）',
        products: [],
        cart: null,
        action: null
      };
      emit('delta', { text: result.reply });
    } else {
      currentMode = 'local';
      emit('notice', { text: '大模型暂时不可用，已切换到本地规则模式：' + fallbackReason });
      emit('meta', { conversationId: conversation.id, mode: currentMode, cartId: conversation.cartId, fallback: true });
      try {
        result = await tools.withTrace(trace, () =>
          localBrain.run({ conversation, message: text, emit: safeEmit, user })
        );
      } catch (localErr) {
        console.error('[Agent 本地模式失败]', localErr);
        throw new HttpError(500, 50031, '助手暂时不可用：' + localErr.message);
      }
    }
  }

  // 注意：不要在这里补发空购物车。
  // 工具在"未知 cartId"上会新建购物车，并已经 emit 了完整的 cart 快照；
  // 再补一个 items: [] 会把前端刚加进去的商品擦掉。

  conversationStore.append(conversation, {
    role: 'assistant',
    content: result.reply,
    products: compactCards(result.products),
    actionId: result.action ? result.action.id : null
  });
  conversationStore.save(conversation);

  const record = {
    at: new Date().toISOString(),
    conversationId: conversation.id,
    userId: user ? user.id : null,
    mode: currentMode,
    fallbackReason,
    message: text,
    reply: result.reply,
    toolCalls: trace,
    productIds: (result.products || []).map((item) => item.id),
    actionId: result.action ? result.action.id : null,
    durationMs: Date.now() - startedAt
  };
  writeTrace(record);

  emit('done', {
    conversationId: conversation.id,
    mode: currentMode,
    cartId: conversation.cartId,
    reply: result.reply,
    products: result.products || [],
    action: result.action || null,
    toolCalls: trace,
    durationMs: record.durationMs
  });

  return { conversation, result, mode: currentMode, trace };
}

function normalizeReceiver(input = {}) {
  const name = String(input.name || '').trim();
  const phone = String(input.phone || '').trim();
  const address = String(input.address || '').trim();
  if (name.length < 2) throw new HttpError(400, 40041, '收货人姓名至少 2 个字');
  if (!/^1\d{10}$/.test(phone)) throw new HttpError(400, 40042, '手机号要填 1 开头的 11 位数字');
  if (address.length < 5) throw new HttpError(400, 40043, '收货地址至少 5 个字');
  return { name, phone, address };
}

/**
 * 用户在前端点了"确认下单"。
 * 这里再校验一次动作状态、收货信息、购物车；金额由订单服务重算。
 */
async function confirm({ conversationId, actionId, approved, receiver, remark, user }) {
  const conversation = conversationStore.get(conversationId);
  if (!conversation) throw new HttpError(404, 40430, '会话不存在或已过期，刷新页面重新问一次吧');

  const action = conversation.pending[actionId];
  if (!action) throw new HttpError(404, 40431, '这个待确认动作不存在');
  if (action.status !== 'pending') throw new HttpError(409, 40931, '这个动作已经处理过了');

  if (!approved) {
    action.status = 'rejected';
    action.finishedAt = new Date().toISOString();
    conversationStore.append(conversation, { role: 'assistant', content: '好的，这次不下单。购物车里的东西还在，想好了随时说“下单”。' });
    conversationStore.save(conversation);
    return { cancelled: true, actionId, conversationId: conversation.id };
  }

  const parsedReceiver = normalizeReceiver(receiver);
  const order = orderService.create({
    cartId: action.args.cartId,
    receiver: parsedReceiver,
    remark: String(remark || action.args.remark || '').slice(0, 60),
    userId: user ? user.id : null
  });

  action.status = 'done';
  action.orderId = order.id;
  action.finishedAt = new Date().toISOString();
  conversationStore.append(conversation, {
    role: 'assistant',
    content: '订单已创建：' + order.id + '，共 ' + order.items.reduce((sum, item) => sum + item.quantity, 0) + ' 件，实付 ¥' + order.totalAmount + '。订单状态是「待支付」，可以在“我的订单”里完成模拟支付。',
    orderId: order.id
  });
  conversationStore.save(conversation);

  writeTrace({
    at: new Date().toISOString(),
    type: 'confirm',
    conversationId: conversation.id,
    actionId,
    userId: user ? user.id : null,
    orderId: order.id,
    amount: order.totalAmount
  });

  return { cancelled: false, order, conversationId: conversation.id };
}

function conversationView(id) {
  const conversation = conversationStore.get(id);
  return conversation ? conversationStore.publicView(conversation) : null;
}

module.exports = { chat, confirm, conversationView, mode, TRACE_FILE };
