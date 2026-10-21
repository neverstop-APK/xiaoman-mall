/**
 * 【文件作用】AI 助手会话存储：一个用户和助手的一段对话
 * ------------------------------------------------------------
 * 为什么不用内存 Map？因为 Node 一重启就丢，考核演示时刷新页面也会丢。
 * 这里复用 JSON 存储层，会话结构和订单一样直接落盘：
 *
 *   {
 *     id, userId, cartId,
 *     messages: [{ role, content, at, products?, action? }],
 *     memory:   { lastQuery, lastProducts: [id], lastCategory },
 *     pending:  { act_xxx: { type, args, summary, amount, status } },
 *     createdAt, updatedAt
 *   }
 *
 * memory 是"多轮约束"的关键：
 *   用户说"便宜一点"时，助手要记得上一轮搜了什么、结果价格是多少，
 *   所以把上一轮的查询条件和商品 id 一起存下来，而不是让模型自己猜。
 *
 * 【对应知识点】JSON 持久化、对象结构设计、数组截断
 * 【对应考核点】9.3 多轮对话中的约束、9.7 会话持久化
 */
const crypto = require('node:crypto');
const store = require('../lib/store-JSON数据存储');

const MAX_MESSAGES = 60; // 单会话最多留 60 条，超了从头删，防止文件无限增长
const MAX_CONVERSATIONS = 200;

function newId(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function all() {
  return store.read('conversations', []);
}

function saveAll(list) {
  return store.write('conversations', list);
}

/** 只保留最近的会话，避免演示久了文件越来越大 */
function trimAll(list) {
  if (list.length <= MAX_CONVERSATIONS) return list;
  return list
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, MAX_CONVERSATIONS);
}

function create({ userId = null, cartId = '' } = {}) {
  const now = new Date().toISOString();
  const conversation = {
    id: newId('conv_'),
    userId,
    cartId,
    messages: [],
    memory: { lastQuery: null, lastProducts: [], lastCategory: '' },
    pending: {},
    createdAt: now,
    updatedAt: now
  };
  const list = all();
  list.push(conversation);
  saveAll(trimAll(list));
  return conversation;
}

function get(id) {
  return all().find((item) => item.id === id) || null;
}

/** 取会话；id 不存在（比如清了数据）就新建一个，前端不用处理 404 */
function getOrCreate(id, options = {}) {
  const found = id ? get(id) : null;
  if (found) {
    if (options.userId && !found.userId) {
      found.userId = options.userId;
      found.updatedAt = new Date().toISOString();
      save(found);
    }
    if (options.cartId) found.cartId = options.cartId;
    return found;
  }
  return create(options);
}

function save(conversation) {
  conversation.updatedAt = new Date().toISOString();
  if (conversation.messages.length > MAX_MESSAGES) {
    conversation.messages = conversation.messages.slice(-MAX_MESSAGES);
  }
  const list = all();
  const index = list.findIndex((item) => item.id === conversation.id);
  if (index >= 0) list[index] = conversation;
  else list.push(conversation);
  saveAll(trimAll(list));
  return conversation;
}

/**
 * 追加一条消息。
 * 助手消息可以带 products（商品卡）和 action（待确认动作），
 * 刷新页面后前端还能把卡片重新画出来。
 */
function append(conversation, message) {
  conversation.messages.push({ at: new Date().toISOString(), ...message });
  return save(conversation);
}

function remember(conversation, patch) {
  conversation.memory = { ...conversation.memory, ...patch };
  return save(conversation);
}

/** 每次请求最多带最近 12 条给模型，控制上下文长度（9.7 上下文裁剪） */
function recentMessages(conversation, limit = 12) {
  return conversation.messages.slice(-limit).map((msg) => ({
    role: msg.role,
    content: msg.content
  }));
}

/** 给前端的公开结构：不暴露内部 memory 细节 */
function publicView(conversation) {
  return {
    id: conversation.id,
    userId: conversation.userId || null, // 接口层用它判断"这段会话是不是你的"
    messages: conversation.messages.slice(-40),
    cartId: conversation.cartId,
    pending: Object.values(conversation.pending).filter((action) => action.status === 'pending'),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

module.exports = {
  create,
  get,
  getOrCreate,
  save,
  append,
  remember,
  recentMessages,
  publicView,
  newId
};
