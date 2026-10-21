/**
 * 【文件作用】商品详情页逻辑：按 URL 上的 id 请求详情，渲染规格 / 库存 / 相关推荐，处理加入购物车
 * --------------------------------------------------------------------------
 * 详情页和首页最大的区别：它一进来就要知道"看的是哪一件商品"。
 * 这个信息放在地址栏上（product-商品详情页.html?id=p02），
 * 原因和首页筛选一样——链接可以分享、可以刷新、可以后退。
 *
 * 一次进详情页会发两个请求：
 *   ① GET /api/products/:id           拿这件商品
 *   ② GET /api/products/:id/related   拿同类推荐（和①并行，不互相等待）
 * 记法是：互不依赖的请求用 Promise.all 一起发，能少等一半时间。
 *
 * 【对应知识点】URLSearchParams、async / await、Promise.all、DOM 修改、表单控件禁用
 * 【对应考核点】3.6 商品详情（名称 / 图片 / 价格 / 介绍 / 分类 / 库存 / 加购）
 */
import { api, formatMoney } from './api-请求封装.js';
import { cartStore } from './store-购物车状态.js';
import { $, escapeHtml, toast, bindHeaderSearch, bindCartBadge, openDrawer, syncHeaderHeight } from './ui-通用界面工具.js';
import { cardHtml } from './card-商品卡片.js';
import { initCartDrawer } from './cartdrawer-购物车抽屉.js';
import { initCheckout, openCheckout } from './checkout-结算下单.js';
import { initAuthUI } from './authui-登录注册弹窗.js';
import { initAgentPanel } from './agent-购物助手面板.js';

const MAX_QUANTITY = 99;

let product = null;
let maxQuantity = MAX_QUANTITY;

const el = {
  layout: $('#detailLayout'),
  errorBox: $('#errorBox'),
  errorTitle: $('#errorTitle'),
  errorText: $('#errorText'),
  crumb: $('#crumbName'),
  cover: $('#productCover'),
  name: $('#productName'),
  summary: $('#productSummary'),
  categoryBadge: $('#categoryBadge'),
  stockBadge: $('#stockBadge'),
  brand: $('#metaBrand'),
  rating: $('#metaRating'),
  sales: $('#metaSales'),
  id: $('#metaId'),
  price: $('#productPrice'),
  original: $('#productOriginal'),
  discount: $('#productDiscount'),
  qtyInput: $('#qtyInput'),
  qtyMinus: $('#qtyMinus'),
  qtyPlus: $('#qtyPlus'),
  addBtn: $('#addToCartBtn'),
  buyBtn: $('#buyNowBtn'),
  stockHint: $('#stockHint'),
  specList: $('#specList'),
  intro: $('#introSection'),
  description: $('#productDescription'),
  features: $('#productFeatures'),
  relatedSection: $('#relatedSection'),
  relatedGrid: $('#relatedGrid')
};

/* ======================= 一、小工具 ======================= */

function readProductId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('id') || '').trim();
}

function specRow(label, value) {
  return '<div class="spec-row"><dt>' + label + '</dt><dd>' + escapeHtml(String(value)) + '</dd></div>';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function quantity() {
  const parsed = parseInt(el.qtyInput.value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? clamp(parsed, 1, maxQuantity) : 1;
}

function setButtonsDisabled(disabled) {
  el.addBtn.disabled = disabled;
  el.buyBtn.disabled = disabled;
}

/* ======================= 二、渲染 ======================= */

function renderProduct(item) {
  product = item;
  maxQuantity = clamp(item.stock, 1, MAX_QUANTITY);

  document.title = item.name + ' · 小满商城';
  el.crumb.textContent = item.name;

  el.cover.src = item.cover;
  el.cover.alt = item.name;

  el.name.textContent = item.name;
  el.summary.textContent = item.summary;

  el.categoryBadge.textContent = item.category + ' / ' + item.subCategory;
  el.brand.textContent = item.brand;
  el.rating.textContent = '★ ' + Number(item.rating).toFixed(1);
  el.sales.textContent = '已售 ' + item.sales;
  el.id.textContent = '编号 ' + item.id;

  el.price.textContent = formatMoney(item.price);

  if (item.originalPrice && item.originalPrice > item.price) {
    el.original.textContent = formatMoney(item.originalPrice);
    el.original.hidden = false;

    // 8.5 折这种写法比"省 30 元"更直观，两种都放出来
    const discount = (item.price / item.originalPrice) * 10;
    el.discount.textContent = discount.toFixed(1) + ' 折 · 省 ' + formatMoney(item.originalPrice - item.price);
    el.discount.hidden = false;
  } else {
    el.original.hidden = true;
    el.discount.hidden = true;
  }

  // 库存状态：详情页必须让用户一眼看出"能不能买"
  if (item.stock <= 0) {
    el.stockBadge.textContent = '已售罄';
    el.stockBadge.className = 'badge';
    el.stockHint.textContent = '这件暂时卖完了，可以看看下面的同类推荐。';
    el.qtyInput.value = '1';
    setButtonsDisabled(true);
    el.addBtn.textContent = '已售罄';
  } else {
    el.stockBadge.textContent = item.stock <= 5 ? '仅剩 ' + item.stock + ' 件' : '有货';
    el.stockBadge.className = 'badge ' + (item.stock <= 5 ? 'is-warn' : 'is-ok');
    el.stockHint.textContent = item.stock <= 5
      ? '库存紧张：只剩 ' + item.stock + ' 件，每人限购 99 件。'
      : '现货 ' + item.stock + ' 件，满 99 元包邮。';
    setButtonsDisabled(false);
    el.addBtn.textContent = '加入购物车';
    el.qtyInput.value = '1';
  }

  el.specList.innerHTML =
    specRow('品牌', item.brand) +
    specRow('分类', item.category + ' / ' + item.subCategory) +
    specRow('规格标签', (item.tags || []).join('、') || '—') +
    specRow('库存', item.stock + ' 件') +
    specRow('上架时间', item.createdAt) +
    specRow('商品编号', item.id);

  // 介绍按空行分段，避免把一整段长文本塞进一个 <p>
  const paragraphs = String(item.description || '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => '<p>' + escapeHtml(line.trim()) + '</p>')
    .join('');
  el.description.innerHTML = paragraphs || '<p>这件商品还没有写介绍。</p>';

  el.features.innerHTML = (item.features || [])
    .map((feature) => '<li>' + escapeHtml(feature) + '</li>')
    .join('');

  el.intro.hidden = false;
  el.layout.hidden = false;
  el.layout.setAttribute('aria-busy', 'false');
}

function renderRelated(list) {
  if (!list || !list.length) return;
  el.relatedGrid.innerHTML = list.map((item) => cardHtml(item)).join('');
  el.relatedSection.hidden = false;
}

function renderError(title, text) {
  el.layout.hidden = true;
  el.intro.hidden = true;
  el.relatedSection.hidden = true;
  el.errorTitle.textContent = title;
  el.errorText.textContent = text;
  el.errorBox.hidden = false;
}

/* ======================= 三、请求 ======================= */

const RECENT_KEY = 'xm_recent_products';

/** 记下"最近看过"：只存商品 id，最多 6 个，重复访问会提到最前面 */
function rememberRecent(id) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const kept = Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item !== id) : [];
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...kept].slice(0, 6)));
  } catch (error) {
    // localStorage 被禁用时不影响浏览，静默失败即可
  }
}

async function loadProduct(id) {
  try {
    const item = await api.products.detail(id);
    renderProduct(item);
    rememberRecent(item.id);

    // 相关推荐是"锦上添花"，失败了也不该让整页报错，所以单独 catch
    api.products.related(id)
      .then((list) => renderRelated(list))
      .catch(() => {});
  } catch (error) {
    renderError('商品加载失败', error.message || '接口没有返回这件商品，回列表再挑一件吧。');
  }
}

/* ======================= 四、交互 ======================= */

function bindQuantity() {
  el.qtyMinus.addEventListener('click', () => {
    el.qtyInput.value = String(clamp(quantity() - 1, 1, maxQuantity));
  });

  el.qtyPlus.addEventListener('click', () => {
    el.qtyInput.value = String(clamp(quantity() + 1, 1, maxQuantity));
  });

  el.qtyInput.addEventListener('change', () => {
    el.qtyInput.value = String(quantity());
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function addToCart(openAfter) {
  if (!product || product.stock <= 0) return;

  const amount = quantity();
  const addText = el.addBtn.textContent;
  const buyText = el.buyBtn.textContent;

  setButtonsDisabled(true);
  el.addBtn.textContent = '加入中…';

  try {
    await cartStore.add(product.id, amount);
    toast('已加入购物车：' + product.name + ' × ' + amount, 'success', 1800);

    if (openAfter) {
      // 给用户 0.6 秒看清提示，再弹结算窗口
      await sleep(600);
      openCheckout();
    } else {
      openDrawer($('#cartDrawer'), $('#cartMask'));
    }
  } catch (error) {
    toast(error.message || '加入购物车失败', 'error');
  } finally {
    el.addBtn.textContent = addText;
    el.buyBtn.textContent = buyText;
    setButtonsDisabled(product.stock <= 0);
  }
}

function bindActions() {
  el.addBtn.addEventListener('click', () => addToCart(false));
  el.buyBtn.addEventListener('click', () => addToCart(true));

  // 相关推荐里的加购按钮：事件委托，和首页是同一套写法
  el.relatedGrid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;

    const id = button.dataset.add;
    button.disabled = true;
    try {
      const item = await api.products.detail(id);
      await cartStore.add(id, 1);
      toast('已加入购物车：' + item.name, 'success', 1600);
    } catch (error) {
      toast(error.message || '加入购物车失败', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

/* ======================= 五、启动 ======================= */

function init() {
  syncHeaderHeight();
  initCartDrawer();
  initCheckout();
  initAuthUI();
  initAgentPanel();
  bindCartBadge(cartStore);
  bindQuantity();
  bindActions();

  // 详情页的搜索框：跳回首页，把关键词交给首页的筛选逻辑
  bindHeaderSearch((keyword) => {
    window.location.href = './index-首页.html?keyword=' + encodeURIComponent(keyword) + '#list';
  });

  cartStore.init().catch(() => {});

  const id = readProductId();
  if (!id) {
    renderError('缺少商品编号', '这个地址没有带 ?id= 参数。请从商品列表点进来，或者回首页重新挑一件。');
    return;
  }

  loadProduct(id);
}

init();
