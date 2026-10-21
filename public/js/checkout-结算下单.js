/**
 * 【文件作用】结算下单：填收货信息 -> 创建订单 -> 模拟支付 -> 跳到结果页
 * --------------------------------------------------------------------------
 * 一次下单在前后端之间来回跑了两趟：
 *
 *   ① POST /api/orders       服务端校验库存、重新算钱、生成订单号、写文件、扣库存
 *   ② POST /api/orders/:id/pay 模拟支付，把状态从"待支付"改成"已支付"
 *   ③ 跳转到订单页并带上 ?id=，结果页再用 GET /api/orders/:id 把数据拿回来显示
 *
 * 为什么不直接在①里返回"支付成功"？
 * 因为真实项目里支付是第三方异步回调，不一定立刻成功。
 * 分成两步，前端才能处理"创建成功但支付失败"这种真实情况。
 *
 * 【对应知识点】表单取值、async / await、try / catch / finally、按钮禁用、localStorage
 * 【对应考核点】3.8 提交订单、模拟支付、明确结果页
 */
import { api } from './api-请求封装.js';
import { cartStore } from './store-购物车状态.js';
import { $, toast, openModal, closeModal, bindDismiss } from './ui-通用界面工具.js';

const ORDER_IDS_KEY = 'xm_order_ids';

// 和 server/services/orders-订单服务.js 里的规则保持一致：满 99 包邮，否则运费 12 元
const FREE_SHIPPING_LIMIT = 99;
const SHIPPING_FEE = 12;

const els = {
  wrap: $('#checkoutModal'),
  form: $('#checkoutForm'),
  name: $('#receiverName'),
  phone: $('#receiverPhone'),
  address: $('#receiverAddress'),
  remark: $('#orderRemark'),
  amount: $('#checkoutAmount'),
  payable: $('#checkoutPayable'),
  count: $('#checkoutCount'),
  submit: $('#checkoutSubmit'),
  closeBtn: $('#checkoutCloseBtn')
};

/** 记住订单号：结果页和历史订单都靠它 */
export function rememberOrder(orderId) {
  try {
    const ids = savedOrderIds().filter((id) => id !== orderId);
    ids.unshift(orderId);
    localStorage.setItem(ORDER_IDS_KEY, JSON.stringify(ids.slice(0, 20)));
  } catch {
    // 浏览器禁用了 localStorage 也不影响下单，只是历史记录会丢
  }
}

export function savedOrderIds() {
  try {
    const raw = localStorage.getItem(ORDER_IDS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export function openCheckout() {
  if (!els.wrap) return;
  if (!cartStore.state.items.length) {
    toast('购物车是空的，先挑点喜欢的东西吧', 'error');
    return;
  }
  const goods = cartStore.state.totalAmount;
  const shipping = goods >= FREE_SHIPPING_LIMIT ? 0 : SHIPPING_FEE;
  if (els.amount) els.amount.textContent = '¥' + goods.toFixed(2);
  if (els.payable) els.payable.textContent = '¥' + (goods + shipping).toFixed(2);
  if (els.count) els.count.textContent = String(cartStore.state.totalQuantity);
  openModal(els.wrap);
}

function closeCheckout() {
  if (els.wrap) closeModal(els.wrap);
}

function validate() {
  const name = els.name.value.trim();
  const phone = els.phone.value.trim();
  const address = els.address.value.trim();

  if (name.length < 2) return { ok: false, message: '收货人至少写 2 个字' };
  if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, message: '手机号格式不对，应该是 11 位数字' };
  if (address.length < 5) return { ok: false, message: '收货地址再写详细一点' };

  return { ok: true, value: { name, phone, address } };
}

/** 支付时的假等待：让"支付中"这个状态看得见，体验更接近真实 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitOrder(event) {
  event.preventDefault();

  const checked = validate();
  if (!checked.ok) {
    toast(checked.message, 'error');
    return;
  }

  const button = els.submit;
  const originalText = button.textContent;
  button.disabled = true;

  try {
    button.textContent = '正在创建订单…';

    const order = await api.orders.create({
      cartId: cartStore.getCartId(),
      receiver: checked.value,
      remark: els.remark.value.trim(),
      paymentMethod: 'mock'
    });

    button.textContent = '正在支付…';
    await sleep(900);
    await api.orders.pay(order.id);

    rememberOrder(order.id);
    cartStore.resetLocal();
    closeCheckout();
    toast('支付成功，正在跳转到订单页…', 'success', 1500);

    // 用 location 跳转而不是 window.open，避免被浏览器拦截弹窗
    setTimeout(() => {
      window.location.href = './orders-我的订单页.html?id=' + encodeURIComponent(order.id);
    }, 700);
  } catch (error) {
    toast(error.message || '下单失败，请重试', 'error');
    button.disabled = false;
    button.textContent = originalText;
  }
}

export function initCheckout() {
  if (!els.wrap) return;

  els.form && els.form.addEventListener('submit', submitOrder);
  els.closeBtn && els.closeBtn.addEventListener('click', closeCheckout);
  els.wrap.querySelectorAll('[data-close-checkout]').forEach((btn) => {
    btn.addEventListener('click', closeCheckout);
  });
  bindDismiss({ wrap: els.wrap, onClose: closeCheckout });
}
