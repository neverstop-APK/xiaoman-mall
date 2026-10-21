/**
 * 【文件作用】通用界面工具：选择器、转义、Toast、遮罩层控制、购物车角标
 * --------------------------------------------------------------------------
 * 这些小函数被首页、详情页、订单页同时使用。
 * 单独拆出来的好处是：想改提示条的样式或动画，只动这一个文件。
 *
 * 【对应知识点】DOM 查询与修改、classList、事件监听、定时器、闭包
 * 【对应考核点】3.2 导航交互、3.7 交互反馈
 */

/** 查一个元素，写起来比 document.querySelector 短 */
export const $ = (selector, root = document) => root.querySelector(selector);

/** 查一组元素，返回真正的数组（可以用 forEach / map） */
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * 转义 HTML：商品名、备注这些用户输入的内容在拼进 innerHTML 之前必须转义，
 * 否则输入 <img onerror=...> 就能执行脚本，这是最基础的 XSS 防护。
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 防抖：搜索框输入时不要每按一个键就发一次请求 */
export function debounce(fn, wait = 300) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 常用小图标，统一放这里，避免每个页面各写一份 SVG */
export const ICONS = {
  cartPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M14 10v4M12 12h4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};

/* ---------------- Toast ---------------- */
function toastStack() {
  let stack = $('#toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite'); // 屏幕阅读器会读出提示内容
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * 轻提示
 * @param {string} message 文案
 * @param {'info'|'success'|'error'} type
 */
export function toast(message, type = 'info', duration = 2600) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : '');
  el.textContent = message;
  toastStack().appendChild(el);

  // 最多同时显示 3 条，多了把最早的挤掉，避免糊满屏幕
  const all = $$('.toast', toastStack());
  if (all.length > 3) all[0].remove();

  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

/* ---------------- 遮罩层：抽屉与弹窗共用 ---------------- */
let lockCount = 0; // 用计数而不是布尔值，避免"关一个却把另一个的滚动锁解了"
let lastFocused = null;

function lockScroll() {
  lockCount += 1;
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = '';
}

/** 打开一个侧拉面板（.drawer + .drawer-mask） */
export function openDrawer(panel, mask) {
  lastFocused = document.activeElement;
  mask.classList.add('is-open');
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  lockScroll();
  // 把焦点移进抽屉，键盘用户不会"迷路"
  const focusable = panel.querySelector('button, [href], input, select, textarea');
  if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 60);
}

export function closeDrawer(panel, mask) {
  mask.classList.remove('is-open');
  panel.classList.remove('is-open');
  panel.setAttribute('aria-hidden', 'true');
  unlockScroll();
  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }
}

/** 打开弹窗（.modal-wrap） */
export function openModal(wrap) {
  wrap.classList.add('is-open');
  lockScroll();
  const focusable = wrap.querySelector('input, select, textarea, button');
  if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 80);
}

export function closeModal(wrap) {
  wrap.classList.remove('is-open');
  unlockScroll();
}

/**
 * 通用的"点击遮罩 / 按 Esc 关闭"绑定。
 * 把事件处理写成一个函数，三个页面都能复用。
 */
export function bindDismiss({ panel, mask, wrap, onClose }) {
  const close = () => onClose();
  if (mask) mask.addEventListener('click', close);
  if (wrap) {
    wrap.addEventListener('click', (event) => {
      if (event.target === wrap) close(); // 只有点到遮罩本身才关闭，点内容不关
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const opened = (panel && panel.classList.contains('is-open')) || (wrap && wrap.classList.contains('is-open'));
    if (opened) close();
  });
}

/* ---------------- 页头：搜索与购物车角标 ---------------- */
/**
 * 绑定页头搜索框
 * @param {(keyword: string) => void} handler
 */
export function bindHeaderSearch(handler) {
  const form = $('#searchForm');
  const input = $('#searchInput');
  if (!form || !input) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault(); // 阻止浏览器刷新页面
    handler(input.value.trim());
  });

  // 点清空按钮时把关键词一起清掉
  const clearBtn = $('#searchClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      handler('');
    });
  }
}

/** 把购物车数量同步到页头角标上 */
export function bindCartBadge(store) {
  const badge = $('#cartBadge');
  if (!badge) return;
  store.subscribe((state) => {
    const count = state.totalQuantity;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('is-visible', count > 0);
  });
}

/** 深拷贝一个小对象，避免改到共享的筛选状态（结构化克隆，浏览器原生） */
export function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
