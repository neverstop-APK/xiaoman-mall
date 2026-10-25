/**
 * 【文件作用】AI 购物助手的前端面板：悬浮按钮、对话流、商品卡、下单确认
 * --------------------------------------------------------------------------
 * 这个文件把"助手"从接口变成一个能用的界面，做四件事：
 *   1. 注入界面：右下角按钮 + 对话框（不用改三个 HTML 页面，脚本自己插进去）；
 *   2. 读 SSE：把服务端一段一段写回来的 delta 拼成文字，边收边显示；
 *   3. 画富消息：商品卡可以直接加购，下单卡要用户填收货信息并点确认；
 *   4. 记住会话：conversationId 存 localStorage，刷新页面还能接着聊。
 *
 * 为什么要单独一个模块？
 *   首页、详情页、订单页都要有助手，但三页的业务代码完全不同；
 *   把助手做成"自包含组件"，页面只要 import 一个 initAgentPanel() 即可。
 *
 * 【对应知识点】ES Module、fetch 流式读取、DOM 操作、事件委托、localStorage、Promise
 * 【对应考核点】9.1 对话界面、9.4 写操作确认、9.6 异常处理、9.7 流式与会话持久化
 */
import { api, streamAgentChat, ApiError, formatMoney } from './api-请求封装.js';
import { cartStore } from './store-购物车状态.js';
import { $, escapeHtml, toast } from './ui-通用界面工具.js';
import { authStore } from './auth-登录状态.js';
import { rememberOrder } from './checkout-结算下单.js';

const CONVERSATION_KEY = 'xm_agent_conversation';
const RECEIVER_KEY = 'xm_agent_receiver';

/** 快捷问题：第一次打开时给用户一个"知道能问什么"的台阶 */
const QUICK_QUESTIONS = ['500 元以内的键盘', '有没有适合通勤的耳机', '把刚才第一件加入购物车', '帮我下单'];

/** 面板内部的临时状态，不放进 cartStore / authStore，避免污染全局 */
const state = {
  conversationId: '',
  busy: false,
  mode: 'local',
  model: '',
  messageCount: 0,
  authReady: false,
  lastUserId: undefined
};

const els = {};

/* ==========================================================================
   一、注入界面
   ========================================================================== */
function injectMarkup() {
  if ($('#agentRoot')) return;

  const root = document.createElement('div');
  root.id = 'agentRoot';
  root.innerHTML = `
    <button class="agent-fab" id="agentFab" type="button" aria-expanded="false" aria-controls="agentPanel" aria-label="打开小满购物助手">
      <span class="agent-fab-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M18.5 15.5 19.4 18l2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5Z"/></svg>
      </span>
      <span class="agent-fab-label">问问小满</span>
    </button>

    <div class="agent-backdrop" id="agentBackdrop"></div>

    <section class="agent-panel" id="agentPanel" role="dialog" aria-modal="true" aria-labelledby="agentTitle" aria-hidden="true" inert>
      <header class="agent-head">
        <div class="agent-id">
          <span class="agent-avatar" aria-hidden="true">满</span>
          <div>
            <h2 id="agentTitle">小满助手</h2>
            <p class="agent-mode" id="agentMode">正在连接…</p>
          </div>
        </div>
        <div class="agent-head-actions">
          <button class="agent-icon-btn" id="agentNewBtn" type="button" title="开始新对话" aria-label="开始新对话">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="agent-icon-btn" id="agentCloseBtn" type="button" title="关闭助手" aria-label="关闭助手">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </header>

      <div class="agent-log" id="agentLog" role="log" aria-live="polite" aria-relevant="additions text"></div>

      <div class="agent-chips" id="agentChips"></div>

      <form class="agent-composer" id="agentForm">
        <label class="sr-only" for="agentInput">给助手发消息</label>
        <textarea id="agentInput" rows="1" maxlength="500" placeholder="想找什么？例如：500 元以内的键盘" autocomplete="off"></textarea>
        <button class="agent-send" id="agentSend" type="submit" aria-label="发送">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z"/></svg>
        </button>
      </form>
    </section>
  `;
  document.body.appendChild(root);

  els.root = root;
  els.fab = $('#agentFab');
  els.panel = $('#agentPanel');
  els.backdrop = $('#agentBackdrop');
  els.log = $('#agentLog');
  els.chips = $('#agentChips');
  els.form = $('#agentForm');
  els.input = $('#agentInput');
  els.send = $('#agentSend');
  els.newBtn = $('#agentNewBtn');
  els.closeBtn = $('#agentCloseBtn');
  els.mode = $('#agentMode');
}

/* ==========================================================================
   二、打开 / 关闭
   ========================================================================== */
function openPanel() {
  els.panel.classList.add('is-open');
  els.backdrop.classList.add('is-open');
  els.fab.setAttribute('aria-expanded', 'true');
  els.panel.setAttribute('aria-hidden', 'false');
  els.panel.inert = false;
  document.documentElement.classList.add('agent-open');

  // 打开后把焦点放进输入框，键盘用户不用再 Tab 一圈
  window.setTimeout(() => els.input.focus(), 80);
  scrollToBottom(true);
}

function closePanel() {
  els.panel.classList.remove('is-open');
  els.backdrop.classList.remove('is-open');
  els.fab.setAttribute('aria-expanded', 'false');
  els.panel.setAttribute('aria-hidden', 'true');
  els.panel.inert = true;
  document.documentElement.classList.remove('agent-open');
  els.fab.focus();
}

function togglePanel() {
  if (els.panel.classList.contains('is-open')) closePanel();
  else openPanel();
}

/** 键盘焦点不要跑出对话框（简单的焦点陷阱） */
function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const focusables = Array.from(
    els.panel.querySelectorAll('button, textarea, input, a[href], [tabindex]:not([tabindex="-1"])')
  ).filter((node) => !node.disabled && node.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ==========================================================================
   三、消息渲染
   ========================================================================== */
/** 把某一轮提问滚到消息区顶部：答案很长时先看到开头，而不是只看到最后一张卡 */
function scrollToRow(row) {
  if (!els.log || !row) return;
  window.requestAnimationFrame(() => {
    const top = row.getBoundingClientRect().top - els.log.getBoundingClientRect().top + els.log.scrollTop - 10;
    els.log.scrollTop = Math.max(0, top);
  });
}

function scrollToBottom(force = false) {
  if (!els.log) return;
  const gap = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight;
  if (force || gap < 160) {
    window.requestAnimationFrame(() => {
      els.log.scrollTop = els.log.scrollHeight;
    });
  }
}

/** 用户消息：右侧气泡 */
function addUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'agent-msg agent-msg--user';
  const bubble = document.createElement('div');
  bubble.className = 'agent-bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  els.log.appendChild(row);
  scrollToBottom(true);
  return row;
}

/**
 * 助手消息：左侧气泡 + 可选商品卡 / 下单卡 / 工具调用详情
 * 返回一组引用，流式输出时只改 textNode，不重建整块 DOM。
 */
function createBotMessage(initialText = '') {
  const row = document.createElement('div');
  row.className = 'agent-msg agent-msg--bot';

  const bubble = document.createElement('div');
  bubble.className = 'agent-bubble';

  const text = document.createElement('span');
  text.className = 'agent-text';
  if (initialText) text.textContent = initialText;
  else bubble.appendChild(makeTyping());

  bubble.appendChild(text);

  const status = document.createElement('p');
  status.className = 'agent-status';
  status.hidden = true;

  row.appendChild(bubble);
  row.appendChild(status);
  els.log.appendChild(row);
  scrollToBottom(true);

  return { row, bubble, text, status, productsEl: null, actionEl: null, traceEl: null };
}

function makeTyping() {
  const typing = document.createElement('span');
  typing.className = 'agent-typing';
  typing.setAttribute('aria-label', '助手正在输入');
  typing.innerHTML = '<i></i><i></i><i></i>';
  return typing;
}

/** 第一次有文字回来时，把"三个点"换成真正的文字 */
function setMessageText(msg, text) {
  const typing = msg.bubble.querySelector('.agent-typing');
  if (typing) typing.remove();
  if (!msg.text.isConnected) msg.bubble.appendChild(msg.text);
  msg.text.textContent = text;
  scrollToBottom();
}

function setStatus(msg, text) {
  if (!text) {
    msg.status.hidden = true;
    return;
  }
  msg.status.hidden = false;
  msg.status.textContent = text;
  scrollToBottom();
}

function addNote(text, type = 'info') {
  const note = document.createElement('div');
  note.className = 'agent-note' + (type === 'error' ? ' agent-error' : '');
  note.textContent = text;
  els.log.appendChild(note);
  scrollToBottom();
  return note;
}

/** 商品卡：封面 + 名称 + 价格 + 加购按钮 */
function renderProducts(msg, products) {
  if (!Array.isArray(products) || !products.length) return;
  if (!msg.productsEl) {
    msg.productsEl = document.createElement('div');
    msg.productsEl.className = 'agent-products';
    msg.row.appendChild(msg.productsEl);
  }
  msg.productsEl.innerHTML = '';

  products.slice(0, 6).forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'agent-product';
    const soldOut = Number(item.stock) <= 0;
    card.innerHTML = `
      <div class="agent-product-thumb">
        <img class="agent-product-cover" src="${escapeHtml(item.cover || '')}" alt="" loading="lazy">
        ${products.length > 1 ? '<span class="agent-product-no" aria-hidden="true">' + (index + 1) + '</span>' : ''}
      </div>
      <div class="agent-product-main">
        <a class="agent-product-name" href="./product-商品详情页.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>
        <div class="agent-product-meta">
          <span class="agent-product-price">${formatMoney(item.price)}</span>
          <span class="agent-product-stock">${soldOut ? '暂时缺货' : '库存 ' + item.stock}</span>
        </div>
      </div>
      <button class="agent-product-add" type="button" data-add="${escapeHtml(item.id)}" ${soldOut ? 'disabled' : ''}>
        ${soldOut ? '缺货' : '加入购物车'}
      </button>
    `;

    const addBtn = card.querySelector('[data-add]');
    if (addBtn && !soldOut) {
      addBtn.addEventListener('click', async () => {
        addBtn.disabled = true;
        addBtn.textContent = '加入中…';
        try {
          await cartStore.add(item.id, 1);
          addBtn.textContent = '已加入';
          toast('已加入购物车，右下角抽屉里可以改数量');
        } catch (error) {
          addBtn.disabled = false;
          addBtn.textContent = '加入购物车';
          toast(error.message, 'error');
        }
      });
    }

    msg.productsEl.appendChild(card);
  });

  // 卡片是异步补上的：这里只温和跟随，等整轮结束再把视图定位到提问处
  scrollToBottom();
}

/**
 * 下单确认卡：9.4 的关键
 * 助手只生成"待确认动作"，这里把动作画成表单，用户点确认才真正创建订单。
 */
function renderAction(msg, action, { fromHistory = false } = {}) {
  if (!action || !action.id) return;
  if (msg.actionEl) msg.actionEl.remove();

  const saved = readReceiver();
  const receiver = {
    name: saved.name || (authStore.state.user && (authStore.state.user.nickname || authStore.state.user.username)) || '王小满',
    phone: saved.phone || '13800001234',
    address: saved.address || '浙江省杭州市西湖区 小满路 1 号 3 幢 201'
  };

  const card = document.createElement('div');
  card.className = 'agent-action';
  const items = (action.items || []).map((item) => `<li><span>${escapeHtml(item.name)} × ${item.quantity}</span><span>${formatMoney(item.subtotal)}</span></li>`).join('');

  card.innerHTML = `
    <div class="agent-action-head">
      <span class="agent-action-title">确认订单 · ${action.quantity || 0} 件</span>
      <span class="agent-action-amount">${formatMoney(action.amount || 0)}</span>
    </div>
    <ul class="agent-action-list">${items}</ul>
    <div class="agent-action-fields">
      <label class="field">
        <span class="field-label">收货人</span>
        <input class="input" data-receiver="name" maxlength="12" value="${escapeHtml(receiver.name)}" autocomplete="name">
      </label>
      <label class="field">
        <span class="field-label">手机号</span>
        <input class="input" data-receiver="phone" inputmode="numeric" maxlength="11" value="${escapeHtml(receiver.phone)}" autocomplete="tel">
      </label>
      <label class="field">
        <span class="field-label">收货地址</span>
        <input class="input" data-receiver="address" maxlength="60" value="${escapeHtml(receiver.address)}" autocomplete="street-address">
      </label>
    </div>
    <div class="agent-action-foot">
      <p class="agent-action-note">确认后才会创建订单，金额由服务端重算</p>
      <div class="agent-action-buttons">
        <button class="btn btn-ghost" type="button" data-action="cancel">再想想</button>
        <button class="btn btn-primary" type="button" data-action="confirm">确认下单</button>
      </div>
    </div>
  `;

  const buttons = card.querySelectorAll('[data-action]');
  const confirmBtn = card.querySelector('[data-action="confirm"]');
  const cancelBtn = card.querySelector('[data-action="cancel"]');

  const setCardBusy = (busy) => {
    buttons.forEach((btn) => {
      btn.disabled = busy;
    });
    confirmBtn.textContent = busy ? '正在创建订单…' : '确认下单';
  };

  confirmBtn.addEventListener('click', async () => {
    const payloadReceiver = {};
    card.querySelectorAll('[data-receiver]').forEach((input) => {
      payloadReceiver[input.dataset.receiver] = input.value.trim();
    });

    // 前端先校验一次，是为了体验（不用等一个来回）；服务端还会再校验一次
    if (payloadReceiver.name.length < 2) return toast('收货人姓名至少 2 个字', 'error');
    if (!/^1\d{10}$/.test(payloadReceiver.phone)) return toast('手机号要填 1 开头的 11 位数字', 'error');
    if (payloadReceiver.address.length < 5) return toast('收货地址至少写 5 个字', 'error');

    setCardBusy(true);
    try {
      const data = await api.agent.confirm({
        conversationId: state.conversationId,
        actionId: action.id,
        approved: true,
        receiver: payloadReceiver
      });
      saveReceiver(payloadReceiver);
      rememberOrder(data.order.id);
      cartStore.resetLocal(); // 服务端下单后已经清空购物车，前端也要同步
      const result = renderOrderResult(data.order);
      card.replaceWith(result);
      msg.actionEl = result;
      toast('订单已创建，可以继续模拟支付');
      scrollToBottom(true);
    } catch (error) {
      setCardBusy(false);
      addNote(error.message, 'error');
    }
  });

  cancelBtn.addEventListener('click', async () => {
    setCardBusy(true);
    try {
      await api.agent.confirm({
        conversationId: state.conversationId,
        actionId: action.id,
        approved: false
      });
      const note = document.createElement('p');
      note.className = 'agent-action-note';
      note.textContent = '已取消这次下单，购物车里的商品还在。';
      card.replaceWith(note);
      msg.actionEl = note;
    } catch (error) {
      setCardBusy(false);
      addNote(error.message, 'error');
    }
  });

  msg.row.appendChild(card);
  msg.actionEl = card;
  scrollToBottom(true);
  if (fromHistory) {
    // 恢复历史时不要抢焦点，用户可能只是想看看
    card.dataset.history = 'true';
  }
}

/** 下单成功卡：订单号 + 金额 + 去支付 / 查看订单 */
function renderOrderResult(order) {
  const box = document.createElement('div');
  box.className = 'agent-result';
  const total = order.totalAmount ?? order.total ?? 0;
  const statusText = order.statusText || '待支付';
  box.innerHTML = `
    <div class="agent-result-head">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>
      订单已创建
    </div>
    <p>订单号 <code>${escapeHtml(order.id)}</code><br>共 ${order.items ? order.items.reduce((sum, item) => sum + item.quantity, 0) : 0} 件 · 实付 ${formatMoney(total)} · 状态「${escapeHtml(statusText)}」</p>
    <div class="agent-result-links">
      <a class="btn btn-primary" href="./orders-我的订单页.html?id=${encodeURIComponent(order.id)}">去支付 / 查看订单</a>
      <button class="btn btn-ghost" type="button" data-continue>继续逛</button>
    </div>
  `;
  const continueBtn = box.querySelector('[data-continue]');
  if (continueBtn) continueBtn.addEventListener('click', closePanel);
  return box;
}

/** 工具调用详情：默认收起，展开就能看到"模型调了什么、传了什么参数" */
function renderTrace(msg, toolCalls, durationMs) {
  if (!Array.isArray(toolCalls) || !toolCalls.length || msg.traceEl) return;
  const details = document.createElement('details');
  details.className = 'agent-trace';
  const summary = document.createElement('summary');
  summary.textContent = `查看本轮工具调用（${toolCalls.length} 次 · ${durationMs || 0}ms）`;
  const list = document.createElement('ul');
  toolCalls.forEach((call) => {
    const li = document.createElement('li');
    const args = call.args ? JSON.stringify(call.args) : '{}';
    li.innerHTML = `<code>${escapeHtml(call.name)}</code> <span class="agent-trace-args">${escapeHtml(args)}</span> <em class="${call.ok ? 'ok' : 'bad'}">${call.ok ? '成功' : '失败'} · ${call.ms || 0}ms</em>`;
    list.appendChild(li);
  });
  details.appendChild(summary);
  details.appendChild(list);
  msg.row.appendChild(details);
  msg.traceEl = details;
}

/* ==========================================================================
   四、发送与接收
   ========================================================================== */
function setBusy(busy) {
  state.busy = busy;
  els.send.disabled = busy;
  els.newBtn.disabled = busy;
  els.chips.hidden = busy;
  els.form.classList.toggle('is-busy', busy);
}

function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 104) + 'px';
}

async function sendMessage(rawText) {
  const text = String(rawText || '').trim();
  if (!text || state.busy) return;

  const userRow = addUserMessage(text);
  els.input.value = '';
  autoResize();
  setBusy(true);

  const msg = createBotMessage();
  let streamed = '';
  let streamError = '';
  let productsShown = false;
  let actionShown = false;

  try {
    const done = await streamAgentChat({
      conversationId: state.conversationId,
      message: text,
      cartId: cartStore.getCartId(),
      onEvent(event, payload) {
        if (event === 'meta') {
          if (payload.mode) updateMode(payload.mode);
          if (payload.conversationId) rememberConversation(payload.conversationId);
        } else if (event === 'status') {
          setStatus(msg, payload.text || '');
        } else if (event === 'notice') {
          addNote(payload.text || '');
        } else if (event === 'delta') {
          streamed += payload.text || '';
          setStatus(msg, '');
          setMessageText(msg, streamed);
        } else if (event === 'products') {
          productsShown = true;
          renderProducts(msg, payload);
        } else if (event === 'cart') {
          if (payload && Array.isArray(payload.items)) cartStore.applyCart(payload);
        } else if (event === 'action') {
          actionShown = true;
          renderAction(msg, payload);
        } else if (event === 'error') {
          streamError = payload.message || '助手开小差了';
        }
      }
    });

    if (streamError) throw new ApiError(streamError);

    const reply = streamed || done.reply || '';
    if (!streamed && reply) setMessageText(msg, reply);
    if (!reply) setMessageText(msg, '这轮没整理出结果，可以换个说法再试一次。');

    if (done.products && !productsShown) renderProducts(msg, done.products);
    if (done.action && !actionShown) renderAction(msg, done.action);
    if (done.mode) updateMode(done.mode);
    if (done.conversationId) rememberConversation(done.conversationId);
    if (done.cartId) cartStore.setCartId(done.cartId);
    renderTrace(msg, done.toolCalls, done.durationMs);
    // 有确认卡时把卡片整张露出来；普通回答则从提问处开始看
    scrollToRow(msg.actionEl || userRow);

    state.messageCount += 2;
  } catch (error) {
    setMessageText(msg, '抱歉，这次没接上：' + error.message);
    msg.bubble.classList.add('agent-error-bubble');
    addNote('可以再试一次，或者换个更短的说法。', 'error');
    if (error instanceof ApiError && (error.code === 40330 || error.code === 40430)) {
      forgetConversation();
    }
  } finally {
    setStatus(msg, '');
    setBusy(false);
    els.input.focus();
  }
}

function updateMode(mode) {
  state.mode = mode;
  if (mode === 'llm') {
    els.mode.textContent = '大模型模式 · ' + (state.model || 'deepseek');
    els.mode.title = '模型回复，工具调用与本地模式共用一套';
  } else {
    els.mode.textContent = '本地规则模式';
    els.mode.title = '没有配置 API Key 时使用内置规则引擎，全部功能离线可用';
  }
}

/* ==========================================================================
   五、会话恢复 / 新建
   ========================================================================== */
function rememberConversation(id) {
  state.conversationId = id;
  try {
    localStorage.setItem(CONVERSATION_KEY, id);
  } catch {
    /* 隐私模式下写不了 localStorage，不影响聊天 */
  }
}

function forgetConversation() {
  state.conversationId = '';
  try {
    localStorage.removeItem(CONVERSATION_KEY);
  } catch {
    /* 忽略 */
  }
}

function clearLog() {
  els.log.innerHTML = '';
  state.messageCount = 0;
}

function showWelcome() {
  const msg = createBotMessage(
    '你好，我是小满。可以帮你找商品、比价格、加购物车；选好之后，我会把订单整理成一张确认卡，你点确认才会真正下单。'
  );
  scrollToBottom(true);
}

/** 恢复上次会话：刷新页面、换个页面都不丢上下文 */
async function restoreConversation() {
  let id = '';
  try {
    id = localStorage.getItem(CONVERSATION_KEY) || '';
  } catch {
    id = '';
  }
  if (!id) {
    showWelcome();
    return;
  }

  try {
    const view = await api.agent.conversation(id);
    state.conversationId = view.id;
    if (view.cartId && !cartStore.getCartId()) cartStore.setCartId(view.cartId);

    const pending = new Map((view.pending || []).map((action) => [action.id, action]));
    clearLog();
    if (view.messages && view.messages.length) {
      addNote('已恢复上次的对话');
      view.messages.forEach((message) => {
        if (message.role === 'user') {
          addUserMessage(message.content);
          return;
        }
        const msg = createBotMessage(message.content || '');
        if (message.products && message.products.length) renderProducts(msg, message.products);
        if (message.actionId && pending.has(message.actionId)) {
          renderAction(msg, pending.get(message.actionId), { fromHistory: true });
        }
        if (message.orderId) {
          const result = renderOrderResult({ id: message.orderId, totalAmount: 0, items: [] });
          // 历史里没存金额，隐藏金额那一段，只保留订单号入口
          result.querySelector('p').innerHTML = '订单号 <code>' + escapeHtml(message.orderId) + '</code><br>下单已完成，点下面按钮查看详情。';
          msg.row.appendChild(result);
        }
      });
      state.messageCount = view.messages.length;
    }
    if (!view.messages || !view.messages.length) showWelcome();
    scrollToBottom(true);
  } catch (error) {
    // 会话过期、被清理、或不属于当前账号：安静地开一段新对话
    forgetConversation();
    clearLog();
    showWelcome();
  }
}

async function newConversation() {
  if (state.busy) return;
  forgetConversation();
  clearLog();
  showWelcome();
  els.input.focus();
  toast('已开始新对话');
}

/* ==========================================================================
   六、收货信息的小缓存（只在本机，方便下次再下单）
   ========================================================================== */
function readReceiver() {
  try {
    return JSON.parse(localStorage.getItem(RECEIVER_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveReceiver(receiver) {
  try {
    localStorage.setItem(RECEIVER_KEY, JSON.stringify(receiver));
  } catch {
    /* 忽略 */
  }
}

/* ==========================================================================
   七、初始化
   ========================================================================== */
export function initAgentPanel() {
  if ($('#agentRoot')) return;
  injectMarkup();

  // 快捷问题按钮
  QUICK_QUESTIONS.forEach((question) => {
    const chip = document.createElement('button');
    chip.className = 'agent-chip';
    chip.type = 'button';
    chip.textContent = question;
    chip.addEventListener('click', () => {
      els.input.value = question;
      sendMessage(question);
    });
    els.chips.appendChild(chip);
  });

  els.fab.addEventListener('click', togglePanel);
  els.closeBtn.addEventListener('click', closePanel);
  els.backdrop.addEventListener('click', closePanel);
  els.newBtn.addEventListener('click', newConversation);
  els.panel.addEventListener('keydown', trapFocus);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.panel.classList.contains('is-open')) closePanel();
  });

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(els.input.value);
  });

  els.input.addEventListener('input', autoResize);
  els.input.addEventListener('keydown', (event) => {
    // 输入法组合期间按回车是"选词"，不能当成发送
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(els.input.value);
    }
  });

  // 模式：有 API Key 显示大模型，没有显示本地规则，让演示的人一眼知道现在靠什么跑
  api.agent
    .config()
    .then((config) => {
      state.model = config.model || '';
      state.maxMessage = config.maxMessage || 500;
      updateMode(config.mode);
    })
    .catch(() => {
      els.mode.textContent = '助手已就绪（配置读取失败）';
    });

  // 等登录状态确定后再恢复会话，否则会把"登录用户的会话"误判成 403
  authStore.subscribe((auth) => {
    const userId = auth.user ? auth.user.id : null;
    if (!auth.ready) return;

    if (!state.authReady) {
      state.authReady = true;
      state.lastUserId = userId;
      restoreConversation();
      return;
    }

    if (state.lastUserId !== userId) {
      state.lastUserId = userId;
      // 账号切换后旧会话可能不属于新账号，直接开新的，避免一说话就 403
      forgetConversation();
      clearLog();
      showWelcome();
      addNote(userId ? '账号已登录，开始一段新对话' : '已退出登录，开始一段新对话');
    }
  });
}
