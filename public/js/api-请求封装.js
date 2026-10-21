/**
 * 【文件作用】请求封装：全站唯一"和后端说话"的地方
 * --------------------------------------------------------------------------
 * 页面里绝对不直接写 fetch，原因有三个：
 *   1. 每个请求都要判断 code、处理超时、把错误转成中文——写 20 遍一定会漏；
 *   2. 接口路径改了，只改这一个文件；
 *   3. 统一在这里打日志，排查问题时看控制台就知道发了什么、回来什么。
 *
 * 后端约定：{ code: 0, message: 'ok', data: ... }
 *   code === 0  -> 成功，返回 data
 *   code !== 0  -> 失败，抛 ApiError（页面用 try/catch 接住，弹提示）
 *
 * 【对应知识点】AJAX / fetch、URL 查询参数、async / await、try / catch、Promise、超时
 * 【对应考核点】六、能讲清"前端如何发请求、请求之后发生了什么、接口错误怎么排查"
 */

const BASE_URL = ''; // 同源部署时留空；前后端分离时改成 'http://127.0.0.1:3000'

/** 把对象变成 ?a=1&b=2，自动跳过空值，避免发出 ?category=&page=1 这种脏参数 */
function toQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') return;
    search.set(key, value);
  });
  const text = search.toString();
  return text ? '?' + text : '';
}

/** 自定义错误：把"接口返回的业务错误"和"网络断了"区分开 */
export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code ?? -1;
    this.status = options.status ?? 0;
    this.url = options.url || '';
    this.isNetwork = Boolean(options.isNetwork);
  }
}

/**
 * 核心请求函数
 * @param {string} path 以 /api 开头
 * @param {object} options { method, body, timeout, signal }
 */
export async function request(path, { method = 'GET', body, timeout = 12000 } = {}) {
  // AbortController 用来做超时：到点没回来就主动取消，页面不会一直转圈
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const init = {
    method,
    headers: {},
    signal: controller.signal
  };

  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const startedAt = performance.now();

  try {
    const response = await fetch(BASE_URL + path, init);

    // 服务端返回的一定是 JSON；万一不是（比如 502 网关页面），也要给出人话提示
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('服务器返回了无法解析的内容（HTTP ' + response.status + '）', {
        status: response.status,
        url: path
      });
    }

    // 开发时打开这行，可以在控制台看到每个请求的结果与耗时
    console.debug('[API]', method, path, '->', payload.code, Math.round(performance.now() - startedAt) + 'ms');

    if (payload.code !== 0) {
      throw new ApiError(payload.message || '请求失败', {
        code: payload.code,
        status: response.status,
        url: path
      });
    }

    return payload.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // fetch 只在"网络层失败"时 reject：断网、跨域、超时、服务没启动
    if (error.name === 'AbortError') {
      throw new ApiError('请求超时了，请检查网络后重试', { isNetwork: true, url: path });
    }
    throw new ApiError('连接服务器失败，请确认后端已经启动（node server/index-服务入口.js）', {
      isNetwork: true,
      url: path
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 按业务模块分组，页面里写 api.products.list({...}) 比记路径可读得多 */
export const api = {
  products: {
    list(params) {
      return request('/api/products' + toQuery(params));
    },
    detail(id) {
      return request('/api/products/' + encodeURIComponent(id));
    },
    related(id) {
      return request('/api/products/' + encodeURIComponent(id) + '/related');
    },
    categories() {
      return request('/api/categories');
    },
    recommendations() {
      return request('/api/recommendations');
    }
  },

  cart: {
    get(cartId) {
      return request('/api/cart' + toQuery({ cartId }));
    },
    add({ cartId, productId, quantity = 1 }) {
      return request('/api/cart/items', { method: 'POST', body: { cartId, productId, quantity } });
    },
    updateQuantity({ cartId, productId, quantity }) {
      return request('/api/cart/items/' + encodeURIComponent(productId), {
        method: 'PATCH',
        body: { cartId, quantity }
      });
    },
    remove({ cartId, productId }) {
      return request('/api/cart/items/' + encodeURIComponent(productId) + toQuery({ cartId }), {
        method: 'DELETE'
      });
    },
    clear(cartId) {
      return request('/api/cart' + toQuery({ cartId }), { method: 'DELETE' });
    }
  },

  auth: {
    me() {
      return request('/api/auth/me');
    },
    login({ username, password }) {
      return request('/api/auth/login', { method: 'POST', body: { username, password } });
    },
    register({ username, password, nickname }) {
      return request('/api/auth/register', { method: 'POST', body: { username, password, nickname } });
    },
    logout() {
      return request('/api/auth/logout', { method: 'POST' });
    }
  },

  agent: {
    config() {
      return request('/api/agent/config');
    },
    conversation(id) {
      return request('/api/agent/conversation/' + encodeURIComponent(id));
    },
    confirm(payload) {
      return request('/api/agent/confirm', { method: 'POST', body: payload, timeout: 20000 });
    }
  },

  orders: {
    list() {
      return request('/api/orders');
    },
    create(payload) {
      return request('/api/orders', { method: 'POST', body: payload });
    },
    detail(id) {
      return request('/api/orders/' + encodeURIComponent(id));
    },
    pay(id) {
      return request('/api/orders/' + encodeURIComponent(id) + '/pay', { method: 'POST' });
    },
    cancel(id) {
      return request('/api/orders/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
    }
  }
};

/**
 * AI 助手的流式对话：唯一一个不用 request() 的接口
 * --------------------------------------------------------------------------
 * 普通接口是"一问一答"：等 JSON 回来再解析。
 * 流式接口（SSE）是"一问多答"：服务器边想边往回写，浏览器要一段一段读。
 * 所以这里手动 fetch + 读 ReadableStream，再按 SSE 的格式切出事件。
 *
 * SSE 文本长这样（空行分隔一个事件）：
 *   event: delta
 *   data: {"text":"找"}
 *
 * @param {object} options { conversationId, message, cartId, onEvent, timeout }
 * @returns {Promise<object>} 最后一个 done 事件的 data
 */
export async function streamAgentChat({ conversationId, message, cartId, onEvent, timeout = 90000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let finished = null;

  try {
    const response = await fetch(BASE_URL + '/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ conversationId, message, cartId }),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      let detail = '助手暂时不可用（HTTP ' + response.status + '）';
      try {
        const payload = await response.json();
        if (payload && payload.message) detail = payload.message;
      } catch {
        /* 响应不是 JSON 时保留默认提示 */
      }
      throw new ApiError(detail, { status: response.status, url: '/api/agent/chat' });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 把缓冲区里"已经完整"的事件切出来处理，剩下不完整的留在 buffer 里等下一块
    const drain = () => {
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        let event = 'message';
        const dataLines = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let payload;
        try {
          payload = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        if (event === 'done') finished = payload;
        if (onEvent) onEvent(event, payload);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer += '\n\n';
      drain();
    }

    return finished || {};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('助手响应超时了，请再试一次', { isNetwork: true, url: '/api/agent/chat' });
    }
    throw new ApiError('和助手连接中断了，请检查后端是否启动', { isNetwork: true, url: '/api/agent/chat' });
  } finally {
    clearTimeout(timer);
  }
}

/** 金额格式化：299 -> ¥299.00，统一在这里处理，页面里就不会出现 299 和 299.0 混用 */
export function formatMoney(value) {
  const num = Number(value) || 0;
  return '¥' + num.toFixed(2);
}
