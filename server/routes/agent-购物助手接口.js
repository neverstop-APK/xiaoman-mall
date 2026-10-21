/**
 * 【文件作用】购物助手的 HTTP 接口（含 SSE 流式输出）
 * ------------------------------------------------------------
 * 4 个接口：
 *   POST /api/agent/chat              对话（返回 text/event-stream）
 *   POST /api/agent/confirm           用户确认后真正下单
 *   GET  /api/agent/conversation/:id  刷新页面后恢复会话
 *   GET  /api/agent/config            前端据此显示"本地模式 / 大模型模式"
 *
 * 为什么用 SSE 而不是 WebSocket？
 *   对话是"客户端问一句、服务端持续回一段"，单向流就够了；
 *   SSE 就是普通 HTTP，不需要额外协议升级，Nginx 也好配。
 *
 * 【对应知识点】SSE、res.write、Content-Type、流式响应
 * 【对应考核点】9.7 流式输出
 */
const agent = require('../agent/agent-购物助手');
const tools = require('../agent/tools-工具集');
const llm = require('../agent/llm-大模型适配器');
const { HttpError, ok } = require('../lib/response-统一响应格式');

function sseHandler(ctx) {
  const { req, res, body } = ctx;
  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // 告诉 Nginx 不要缓冲，否则流式会变成"一次性吐出"
  });
  res.write(': connected\n\n');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // 心跳：防止代理或浏览器在长时间无输出时断开连接
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  agent
    .chat({
      conversationId: body.conversationId,
      message: body.message,
      cartId: body.cartId,
      user: ctx.user,
      emit
    })
    .catch((err) => {
      console.error('[Agent 对话失败]', err);
      if (closed) return;
      emit('error', { code: err.code || 50031, message: err.message || '助手开小差了' });
      emit('done', { error: true });
    })
    .finally(() => {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    });
}

/**
 * 用户点"确认下单"后调用。
 * 注意：请求里没有金额，金额由服务端根据购物车和商品表重新算。
 */
async function confirmHandler(ctx) {
  const { body, user, res } = ctx;
  const conversation = agent.conversationView(body.conversationId);
  if (!conversation) throw new HttpError(404, 40430, '会话不存在或已过期，刷新页面重新问一次吧');
  if (conversation.userId && (!user || user.id !== conversation.userId)) {
    throw new HttpError(403, 40330, '这个会话不属于当前账号');
  }

  const result = await agent.confirm({
    conversationId: body.conversationId,
    actionId: body.actionId,
    approved: body.approved !== false,
    receiver: body.receiver,
    remark: body.remark,
    user
  });

  return ok(res, result);
}

function conversationHandler(ctx) {
  const view = agent.conversationView(ctx.params.id);
  if (!view) throw new HttpError(404, 40430, '会话不存在或已过期');
  // 登录用户的会话不允许别人凭 id 打开；游客会话（userId 为 null）仍然可恢复
  if (view.userId && (!ctx.user || ctx.user.id !== view.userId)) {
    throw new HttpError(403, 40330, '这个会话不属于当前账号');
  }
  return ok(ctx.res, view);
}

function configHandler(ctx) {
  const cfg = llm.config();
  return ok(ctx.res, {
    mode: cfg.enabled ? 'llm' : 'local',
    model: cfg.enabled ? cfg.model : '本地规则引擎（无需联网）',
    maxMessage: 500
  });
}

function toolsHandler(ctx) {
  return ok(
    ctx.res,
    tools.DEFINITIONS.map((item) => ({ name: item.function.name, description: item.function.description, parameters: item.function.parameters }))
  );
}

module.exports = ({ add }) => {
  add('POST', '/api/agent/chat', sseHandler);
  add('POST', '/api/agent/confirm', confirmHandler);
  add('GET', '/api/agent/conversation/:id', conversationHandler);
  add('GET', '/api/agent/config', configHandler);
  add('GET', '/api/agent/tools', toolsHandler);
};
