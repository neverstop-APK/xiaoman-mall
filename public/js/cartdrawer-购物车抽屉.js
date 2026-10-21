/**
 * 【文件作用】侧拉购物车：把 store 里的数据画成界面
 * --------------------------------------------------------------------------
 * 这里体现了"数据驱动视图"的做法：
 *   store.subscribe(render) 订阅一次，
 *   之后不管是加购、改数量还是删除，只要数据变了 render 就自动重跑，
 *   不需要在每个按钮的点击事件里手动去改 DOM。
 *
 * 事件用"委托"绑定在容器上（event.target.closest），
 * 所以购物车项重新渲染之后按钮依然有效，不用反复绑事件。
 *
 * 【对应知识点】事件委托、classList、数组 map / join、innerHTML、异步与错误处理
 * 【对应考核点】3.7 添加、删除、改数量、单项金额、总金额、清空
 */
import { cartStore } from './store-购物车状态.js';
import { formatMoney } from './api-请求封装.js';
import { $, escapeHtml, toast, openDrawer, closeDrawer, bindDismiss } from './ui-通用界面工具.js';
import { openCheckout } from './checkout-结算下单.js';

const els = {
  drawer: $('#cartDrawer'),
  mask: $('#cartMask'),
  openBtn: $('#cartOpenBtn'),
  closeBtn: $('#cartCloseBtn'),
  list: $('#cartItems'),
  empty: $('#cartEmpty'),
  footer: $('#cartFooter'),
  shippingHint: $('#cartShippingHint'),
  total: $('#cartTotal'),
  count: $('#cartCount'),
  clearBtn: $('#cartClearBtn'),
  checkoutBtn: $('#cartCheckoutBtn')
};

/** 单个商品行。注意所有来自数据库的文字都经过 escapeHtml */
function itemTemplate(item) {
  const busy = cartStore.isBusy(item.productId);
  return `
    <li class="cart-item" data-id="${escapeHtml(item.productId)}">
      <a href="./product-商品详情页.html?id=${encodeURIComponent(item.productId)}">
        <img class="cart-thumb" src="${escapeHtml(item.cover || '')}" alt="${escapeHtml(item.name)}" loading="lazy">
      </a>
      <div class="cart-item-main">
        <a class="cart-item-name" href="./product-商品详情页.html?id=${encodeURIComponent(item.productId)}">${escapeHtml(item.name)}</a>
        <div class="cart-item-meta">
          <span class="text-xs text-muted">单价 ${formatMoney(item.price)}</span>
          <button type="button" class="cart-remove" data-action="remove">删除</button>
        </div>
        <div class="cart-item-foot">
          <div class="stepper" aria-label="数量">
            <button type="button" data-action="minus" ${busy || item.quantity <= 1 ? 'disabled' : ''} aria-label="减少一件">−</button>
            <input type="number" value="${item.quantity}" min="1" max="${item.stock}" data-action="input" aria-label="${escapeHtml(item.name)} 的数量">
            <button type="button" data-action="plus" ${busy || item.quantity >= item.stock ? 'disabled' : ''} aria-label="增加一件">+</button>
          </div>
          <strong class="cart-item-price">${formatMoney(item.subtotal)}</strong>
        </div>
      </div>
    </li>`;
}

function render(state) {
  if (!els.list) return;

  const hasItems = state.items.length > 0;

  els.list.innerHTML = state.items.map(itemTemplate).join('');
  els.list.hidden = !hasItems;
  if (els.empty) els.empty.hidden = hasItems;
  if (els.footer) els.footer.hidden = !hasItems;

  if (els.total) els.total.textContent = formatMoney(state.totalAmount);
  renderShippingHint(state.totalAmount);
  if (els.count) els.count.textContent = state.totalQuantity + ' 件';
  if (els.checkoutBtn) els.checkoutBtn.disabled = !hasItems;
  if (els.clearBtn) els.clearBtn.disabled = !hasItems;
}

const FREE_SHIPPING_LIMIT = 99;
const SHIPPING_FEE = 12;

/** 免运费进度：与服务端 orders 服务的规则保持一致（满 99 免运，否则 12 元） */
function renderShippingHint(totalAmount) {
  if (!els.shippingHint) return;
  const free = totalAmount >= FREE_SHIPPING_LIMIT;
  const percent = Math.min(100, Math.round((totalAmount / FREE_SHIPPING_LIMIT) * 100));
  els.shippingHint.classList.toggle('is-free', free);
  els.shippingHint.innerHTML = free
    ? '<span class="shipping-text">已满 ¥99，这单免运费</span>'
    : '<span class="shipping-text">再买 ' + formatMoney(FREE_SHIPPING_LIMIT - totalAmount) + ' 免运费，否则加收 ¥' + SHIPPING_FEE + '</span>' +
      '<span class="shipping-bar" aria-hidden="true"><i style="width:' + percent + '%"></i></span>';
}

/** 统一的错误提示：把接口返回的中文 message 原样告诉用户 */
async function runAction(task, successText) {
  try {
    await task();
    if (successText) toast(successText, 'success', 1800);
  } catch (error) {
    toast(error.message || '操作失败了，请重试', 'error');
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const row = button.closest('.cart-item');
  const productId = row && row.dataset.id;
  const action = button.dataset.action;
  const item = cartStore.state.items.find((entry) => entry.productId === productId);
  if (!item) return;

  if (action === 'plus') runAction(() => cartStore.updateQuantity(productId, item.quantity + 1));
  if (action === 'minus') runAction(() => cartStore.updateQuantity(productId, item.quantity - 1));
  if (action === 'remove') runAction(() => cartStore.remove(productId), '已从购物车移除');
}

/** 直接输入数字时，失焦后再同步到服务器，避免边打字边发请求 */
function handleChange(event) {
  const input = event.target.closest('input[data-action="input"]');
  if (!input) return;

  const row = input.closest('.cart-item');
  const productId = row && row.dataset.id;
  const item = cartStore.state.items.find((entry) => entry.productId === productId);
  if (!item) return;

  let quantity = parseInt(input.value, 10);
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
  if (quantity > item.stock) quantity = item.stock;
  if (quantity === item.quantity) return;

  runAction(() => cartStore.updateQuantity(productId, quantity));
}

export function initCartDrawer() {
  if (!els.drawer || !els.mask) return null;

  const open = () => openDrawer(els.drawer, els.mask);
  const close = () => closeDrawer(els.drawer, els.mask);

  els.openBtn && els.openBtn.addEventListener('click', open);
  els.closeBtn && els.closeBtn.addEventListener('click', close);
  bindDismiss({ panel: els.drawer, mask: els.mask, onClose: close });

  els.list && els.list.addEventListener('click', handleClick);
  els.list && els.list.addEventListener('change', handleChange);

  if (els.clearBtn) {
    els.clearBtn.addEventListener('click', () => {
      if (!window.confirm('确定要清空购物车吗？')) return;
      runAction(() => cartStore.clear(), '购物车已清空');
    });
  }

  if (els.checkoutBtn) {
    els.checkoutBtn.addEventListener('click', () => {
      if (!cartStore.state.items.length) return;
      close();
      openCheckout();
    });
  }

  // 订阅数据：一直保持视图和数据一致
  cartStore.subscribe(render);

  return { open, close };
}
