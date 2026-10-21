import { api, formatMoney } from './api-请求封装.js';
import { cartStore } from './store-购物车状态.js';
import { $, escapeHtml, toast, bindCartBadge, bindHeaderSearch, syncHeaderHeight } from './ui-通用界面工具.js';
import { initCartDrawer } from './cartdrawer-购物车抽屉.js';
import { initCheckout, savedOrderIds } from './checkout-结算下单.js';
import { authStore } from './auth-登录状态.js';
import { initAuthUI, openAuth } from './authui-登录注册弹窗.js';
import { initAgentPanel } from './agent-购物助手面板.js';

/* ============================================================
 * 我的订单页
 * 1. 地址栏带 ?id=XM... 时：显示单个订单的完整结果（下单后跳转到这里）
 * 2. 不带 id 时：读取 localStorage 里的订单号，批量查询，列成"最近订单"
 * 3. 订单卡片上可以模拟支付 / 取消 / 复制订单号
 * ============================================================ */

// 订单状态 → 中文与配色（后端也会给 statusText，这里兜底）
const STATUS_TEXT = { pending: '待支付', paid: '已支付', cancelled: '已取消' };
const STATUS_CLASS = { pending: 'is-warn', paid: 'is-ok', cancelled: 'is-accent' };

let currentId = ''; // 当前单订单视图的订单号；为空表示列表视图

/* ---------------- 小工具 ---------------- */

function readOrderId() {
  const id = new URLSearchParams(location.search).get('id');
  return id ? id.trim().toUpperCase() : '';
}

function formatDate(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function statusTextOf(order) {
  return order.statusText || STATUS_TEXT[order.status] || order.status || '未知状态';
}

function statusClassOf(order) {
  return STATUS_CLASS[order.status] || 'is-accent';
}

/* ---------------- 渲染：一个订单 ---------------- */

function itemHtml(item) {
  const cover = item.cover
    ? '<img src="' + escapeHtml(item.cover) + '" alt="' + escapeHtml(item.name) + '" loading="lazy">'
    : '<span class="cart-thumb-emoji">' + escapeHtml(item.emoji || '🛍️') + '</span>';
  return [
    '<div class="order-item">',
    '<span class="order-item-thumb">' + cover + '</span>',
    '<div class="order-item-name">' + escapeHtml(item.name),
    '<span class="order-item-sub">单价 ' + formatMoney(item.price) + ' × ' + item.quantity + '</span>',
    '</div>',
    '<span class="num">×' + item.quantity + '</span>',
    '<span class="num">' + formatMoney(item.subtotal) + '</span>',
    '</div>'
  ].join('');
}

function orderCardHtml(order) {
  const items = (order.items || []).map(itemHtml).join('');
  const actions = [];

  if (order.status === 'pending') {
    actions.push('<button class="btn btn-primary" type="button" data-pay="' + escapeHtml(order.id) + '">立即支付</button>');
    actions.push('<button class="btn btn-ghost" type="button" data-cancel="' + escapeHtml(order.id) + '">取消订单</button>');
  }
  actions.push('<button class="btn btn-ghost" type="button" data-copy="' + escapeHtml(order.id) + '">复制订单号</button>');

  return [
    '<article class="order-card" data-order="' + escapeHtml(order.id) + '">',
    '<div class="order-card-head">',
    '<span>下单时间 ' + formatDate(order.createdAt) + '</span>',
    '<span class="order-no">' + escapeHtml(order.id) + '</span>',
    '<span class="badge ' + statusClassOf(order) + '">' + escapeHtml(statusTextOf(order)) + '</span>',
    '</div>',
    '<div class="order-items">' + items + '</div>',
    '<div class="order-summary">',
    '<div class="line"><span>商品金额</span><span>' + formatMoney(order.goodsAmount) + '</span></div>',
    '<div class="line"><span>运费</span><span>' + (order.shippingFee > 0 ? formatMoney(order.shippingFee) : '包邮') + '</span></div>',
    '<div class="line total"><span>实付金额</span><span class="amount">' + formatMoney(order.totalAmount) + '</span></div>',
    '<p class="text-xs text-muted" style="margin:0.5rem 0 0">收货人 ' + escapeHtml(order.receiver && order.receiver.name || '-') +
      ' · ' + escapeHtml(order.receiver && order.receiver.phone || '-') +
      '<br>地址 ' + escapeHtml(order.receiver && order.receiver.address || '-') +
      (order.remark ? '<br>备注 ' + escapeHtml(order.remark) : '') + '</p>',
    '</div>',
    '<div class="order-actions">' + actions.join('') + '</div>',
    '</article>'
  ].join('');
}

function heroHtml(order) {
  const map = {
    paid: { icon: '✓', cls: '', title: '支付成功，订单已确认', text: '这是模拟支付，不会产生真实扣款。我们已收到你的订单，接下来只需要等它送达。' },
    pending: { icon: '⏳', cls: 'is-pending', title: '订单已创建，等待支付', text: '订单已占用库存。点击"立即支付"完成模拟支付，流程和真实下单一致。' },
    cancelled: { icon: '✕', cls: 'is-error', title: '订单已取消', text: '这笔订单已取消，占用的库存已经退回。需要的话可以回首页重新挑选。' }
  };
  const view = map[order.status] || map.pending;
  const actions = [];

  if (order.status === 'pending') {
    actions.push('<button class="btn btn-primary" type="button" data-pay="' + escapeHtml(order.id) + '">立即支付</button>');
    actions.push('<button class="btn btn-ghost" type="button" data-cancel="' + escapeHtml(order.id) + '">取消订单</button>');
  }
  actions.push('<button class="btn btn-ghost" type="button" data-copy="' + escapeHtml(order.id) + '">复制订单号</button>');
  actions.push('<a class="btn btn-ghost" href="./index-首页.html#list">继续购物</a>');

  return [
    '<section class="order-hero ' + view.cls + '">',
    '<span class="order-hero-icon" aria-hidden="true">' + view.icon + '</span>',
    '<div class="order-hero-text">',
    '<h2 class="h2">' + view.title + '</h2>',
    '<p class="text-sm text-muted">订单号 <strong class="order-no">' + escapeHtml(order.id) + '</strong> · 共 ' +
      order.totalQuantity + ' 件 · 实付 <strong>' + formatMoney(order.totalAmount) + '</strong></p>',
    '<p class="text-sm text-muted">' + view.text + '</p>',
    '</div>',
    '<div class="order-hero-actions">' + actions.join('') + '</div>',
    '</section>'
  ].join('');
}

/* ---------------- 三种视图的切换 ---------------- */

function showLoading(message) {
  const box = $('#orderResult');
  box.innerHTML = '<div class="empty"><span class="skeleton" style="width:3rem;height:3rem;border-radius:50%"></span>' +
    '<span class="text-sm text-muted">' + escapeHtml(message) + '</span></div>';
}

function showError(title, text) {
  $('#orderResult').innerHTML = [
    '<div class="empty">',
    '<span class="empty-emoji" aria-hidden="true">🧾</span>',
    '<span class="empty-title">' + escapeHtml(title) + '</span>',
    '<span class="text-sm text-muted">' + escapeHtml(text) + '</span>',
    '<a class="btn btn-ghost" href="./index-首页.html#list">去逛逛</a>',
    '</div>'
  ].join('');
}

function renderSingle(order) {
  $('#orderResult').innerHTML = heroHtml(order) + '<div style="margin-top:1rem">' + orderCardHtml(order) + '</div>';
  document.title = '订单 ' + order.id + ' · 小满商城';
}

/* ---------------- 数据加载 ---------------- */

async function loadSingle(id) {
  showLoading('正在查询订单 ' + id + ' …');
  try {
    const order = await api.orders.detail(id);
    renderSingle(order);
  } catch (err) {
    showError('没有找到这笔订单', err.message || '请检查订单号是否完整，或回首页重新下单。');
  }
}

function emptyBlock(emoji, title, text, action) {
  return [
    '<div class="empty">',
    '<span class="empty-emoji" aria-hidden="true">' + emoji + '</span>',
    '<span class="empty-title">' + escapeHtml(title) + '</span>',
    '<span class="text-sm text-muted">' + escapeHtml(text) + '</span>',
    action || '',
    '</div>'
  ].join('');
}

/**
 * 订单列表有两种来源：
 *   · 已登录：GET /api/orders，服务端按 userId 返回，换设备也能看到；
 *   · 未登录：只能读本机 localStorage 里记过的订单号（游客订单）。
 */
async function loadHistory() {
  const list = $('#ordersList');
  const section = $('#orderHistorySection');
  const count = $('#ordersCount');
  const user = authStore.state.user;

  section.hidden = false;
  count.textContent = '正在加载…';
  list.innerHTML = '<div class="skeleton" style="height:180px;border-radius:var(--radius)"></div>';

  let orders = [];

  if (user) {
    try {
      orders = await api.orders.list();
    } catch (error) {
      count.textContent = '';
      list.innerHTML = emptyBlock('🔌', '订单加载失败', error.message || '请稍后重试', '<button class="btn btn-ghost" type="button" onclick="location.reload()">重新加载</button>');
      return;
    }
  } else {
    const ids = savedOrderIds();
    if (!ids.length) {
      count.textContent = '';
      list.innerHTML = emptyBlock(
        '🧾',
        '还没有订单',
        '登录后订单会跟着账号走，换设备也能看到；未登录时只能查到这台设备下过的单。',
        '<button class="btn btn-primary" type="button" data-open-login>登录 / 注册</button>' +
          '<a class="btn btn-ghost" href="./index-首页.html#list">先去逛逛</a>'
      );
      return;
    }

    const results = await Promise.allSettled(ids.map(function (id) { return api.orders.detail(id); }));
    results.forEach(function (result) {
      if (result.status === 'fulfilled') orders.push(result.value);
    });
  }

  if (!orders.length) {
    count.textContent = '';
    list.innerHTML = emptyBlock(
      '🗂️',
      '还没有订单',
      user ? '挑一件喜欢的东西，下单后会出现在这里。' : '登录后可跨设备查看订单。',
      user
        ? '<a class="btn btn-primary" href="./index-首页.html#list">去挑点东西</a>'
        : '<button class="btn btn-primary" type="button" data-open-login>登录 / 注册</button>'
    );
    return;
  }

  const hint = user
    ? '共 ' + orders.length + ' 个订单 · 已登录：' + user.nickname
    : '共 ' + orders.length + ' 个订单 · 游客订单（登录后可跨设备查看）';
  count.textContent = hint;
  list.innerHTML = orders.map(orderCardHtml).join('');
}

/* ---------------- 操作：支付 / 取消 / 复制 ---------------- */

async function payOrder(id, button) {
  const label = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = '支付中…';
  }
  try {
    const order = await api.orders.pay(id);
    toast('支付成功，订单已确认', 'success');
    if (currentId) {
      renderSingle(order);
    } else {
      await loadHistory();
    }
  } catch (err) {
    toast(err.message || '支付失败，请稍后再试', 'error');
    if (button) {
      button.disabled = false;
      button.textContent = label || '立即支付';
    }
  }
}

async function cancelOrder(id, button) {
  if (!window.confirm('确定要取消这笔订单吗？取消后库存会退回。')) return;
  const label = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = '取消中…';
  }
  try {
    const order = await api.orders.cancel(id);
    toast('订单已取消', 'success');
    if (currentId) {
      renderSingle(order);
    } else {
      await loadHistory();
    }
  } catch (err) {
    toast(err.message || '取消失败，请稍后再试', 'error');
    if (button) {
      button.disabled = false;
      button.textContent = label || '取消订单';
    }
  }
}

async function copyOrderId(id) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(id);
    } else {
      // 老浏览器兜底：临时 textarea + execCommand
      const area = document.createElement('textarea');
      area.value = id;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('订单号已复制：' + id, 'success');
  } catch (err) {
    toast('复制失败，请手动选中订单号', 'error');
  }
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 事件委托：卡片和头部的按钮都走这里
  document.addEventListener('click', function (event) {
    const pay = event.target.closest('[data-pay]');
    if (pay) return payOrder(pay.dataset.pay, pay);

    const cancel = event.target.closest('[data-cancel]');
    if (cancel) return cancelOrder(cancel.dataset.cancel, cancel);

    const copy = event.target.closest('[data-copy]');
    if (copy) return copyOrderId(copy.dataset.copy);
  });

  $('#orderSearchForm').addEventListener('submit', function (event) {
    event.preventDefault();
    const value = $('#orderSearchInput').value.trim().toUpperCase();
    if (!value) {
      toast('请先输入订单号', 'error');
      $('#orderSearchInput').focus();
      return;
    }
    location.href = './orders-我的订单页.html?id=' + encodeURIComponent(value);
  });

  bindHeaderSearch(function (keyword) {
    if (!keyword) return;
    location.href = './index-首页.html?keyword=' + encodeURIComponent(keyword) + '#list';
  });

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-open-login]')) openAuth('login');
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  syncHeaderHeight();
  initCartDrawer();
  initCheckout();
  initAuthUI();
  initAgentPanel();
  bindCartBadge(cartStore);
  bindEvents();

  // 先确认登录态，再决定订单从服务端列表拿还是读本机
  await authStore.init();

  window.addEventListener('auth:change', function () {
    // 登录 / 退出后重新加载，让列表来源和顶栏同时更新
    location.reload();
  });

  currentId = readOrderId();
  if (currentId) {
    $('#orderHistorySection').hidden = true;
    await loadSingle(currentId);
  } else {
    await loadHistory();
  }

  cartStore.init();
}

init();
