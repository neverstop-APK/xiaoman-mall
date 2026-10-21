/**
 * 【文件作用】全部商品页逻辑：搜索、分类、价格、排序、分页与地址栏同步
 * --------------------------------------------------------------------------
 * 首页只留 8 件热卖和编辑推荐，完整的 26 件商品目录放在这一页。
 * 这一页的职责很单一：把用户选的条件收进 state，拼成 GET /api/products 的查询参数，
 * 再把服务端返回的 list / total / page / pageSize / totalPages 画成卡片和分页。
 *
 * 为什么要单独一页？
 * 搜索、筛选、排序、分页四件事都需要足够的空间；首页负责“逛”，这一页负责“找”。
 * 条件写进地址栏后，刷新、收藏、把链接发给别人，都能看到同一批结果。
 *
 * 【对应知识点】ES6 模块、async / await、URLSearchParams、事件委托、防抖式请求序号
 * 【对应考核点】3.2 商品列表、3.4 关键词搜索、3.5 筛选与排序、3.9 响应式
 */
import { api } from './api-请求封装.js';
import { cardHtml } from './card-商品卡片.js';
import { cartStore } from './store-购物车状态.js';
import { $, escapeHtml, toast, bindHeaderSearch, bindCartBadge, syncHeaderHeight, ICONS } from './ui-通用界面工具.js';
import { initCartDrawer } from './cartdrawer-购物车抽屉.js';
import { initCheckout } from './checkout-结算下单.js';
import { initAuthUI } from './authui-登录注册弹窗.js';
import { initAgentPanel } from './agent-购物助手面板.js';

const PAGE_SIZE = 8;

// 价格区间只是“给用户点的按钮”，真正的过滤仍在服务端做
const PRICE_RANGES = [
  { key: '', label: '全部价格' },
  { key: '0-99', label: '¥99 以下', minPrice: 0, maxPrice: 99 },
  { key: '100-299', label: '¥100–299', minPrice: 100, maxPrice: 299 },
  { key: '300-499', label: '¥300–499', minPrice: 300, maxPrice: 499 },
  { key: '500-', label: '¥500 以上', minPrice: 500, maxPrice: '' }
];

const SORT_KEYS = ['default', 'price-asc', 'price-desc', 'sales-desc', 'rating-desc', 'newest'];

const state = {
  keyword: '',
  category: 'all',
  price: '',
  sort: 'default',
  page: 1
};

let categories = [];
// 快速连续操作时，只认最后一次请求的结果，避免旧数据覆盖新数据
let requestSeq = 0;

const el = {
  list: $('#list'),
  grid: $('#productGrid'),
  empty: $('#emptyState'),
  pagination: $('#pagination'),
  resultCount: $('#resultCount'),
  searchHint: $('#searchHint'),
  categoryChips: $('#categoryChips'),
  priceChips: $('#priceChips'),
  sortSelect: $('#sortSelect')
};

/* ======================= 一、条件与地址栏 ======================= */

function findPriceRange(key) {
  return PRICE_RANGES.find((item) => item.key === key) || PRICE_RANGES[0];
}

function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.keyword = (params.get('keyword') || '').trim();
  state.category = params.get('category') || 'all';

  const price = params.get('price') || '';
  state.price = PRICE_RANGES.some((item) => item.key === price) ? price : '';

  const sort = params.get('sort') || 'default';
  state.sort = SORT_KEYS.includes(sort) ? sort : 'default';

  const page = Number(params.get('page'));
  state.page = Number.isInteger(page) && page > 0 ? page : 1;
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  if (state.keyword) params.set('keyword', state.keyword);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.price) params.set('price', state.price);
  if (state.sort !== 'default') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));

  const query = params.toString();
  // 保留 #list：翻页、筛选后仍停在商品区，而不是跳回页头
  const url = window.location.pathname + (query ? '?' + query : '') + '#list';
  window.history.replaceState(null, '', url);
}

/* ======================= 二、渲染：商品与状态 ======================= */

function renderSkeleton() {
  el.grid.innerHTML = Array.from(
    { length: PAGE_SIZE },
    () => '<div class="skeleton skeleton-card"></div>'
  ).join('');
}

function showEmpty(options) {
  el.empty.innerHTML =
    '<span class="empty-emoji" aria-hidden="true">' + options.emoji + '</span>' +
    '<span class="empty-title">' + escapeHtml(options.title) + '</span>' +
    '<span class="text-sm">' + escapeHtml(options.text) + '</span>' +
    (options.action || '');
  el.empty.hidden = false;
  el.pagination.innerHTML = '';
}

function renderGrid(list) {
  el.grid.innerHTML = list.map((product) => cardHtml(product)).join('');
  el.empty.hidden = list.length > 0;

  if (!list.length) {
    showEmpty({
      emoji: '🔍',
      title: '没有找到符合条件的商品',
      text: '换个关键词，或者把价格区间放宽一点试试。',
      action: '<button class="btn btn-ghost" type="button" data-clear-filters>清除全部筛选</button>'
    });
  }
}

function renderError(error) {
  el.grid.innerHTML = '';
  showEmpty({
    emoji: '🔌',
    title: '商品加载失败',
    text: error.message || '网络似乎不太稳定，稍后再试一次。',
    action: '<button class="btn btn-ghost" type="button" data-retry>重新加载</button>'
  });
}

function renderCount(data) {
  if (!data.total) {
    el.resultCount.textContent = '没有匹配的商品';
    return;
  }
  const first = (data.page - 1) * data.pageSize + 1;
  const last = first + data.list.length - 1;
  el.resultCount.innerHTML = '共 <strong>' + data.total + '</strong> 件 · 第 ' + first + '–' + last + ' 件';
}

function renderPagination(data) {
  if (data.totalPages <= 1) {
    el.pagination.innerHTML = '';
    return;
  }

  // 最多显示 5 个页码，当前页尽量居中
  const pages = [];
  const start = Math.max(1, Math.min(data.page - 2, data.totalPages - 4));
  const end = Math.min(data.totalPages, start + 4);
  for (let page = start; page <= end; page += 1) pages.push(page);

  const numbers = pages
    .map((page) => {
      if (page === data.page) {
        return '<button class="page-btn is-current" type="button" aria-current="page">' + page + '</button>';
      }
      return '<button class="page-btn" type="button" data-page="' + page + '">' + page + '</button>';
    })
    .join('');

  el.pagination.innerHTML =
    '<button class="page-btn" type="button" data-page="' + (data.page - 1) + '"' + (data.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
    numbers +
    '<button class="page-btn" type="button" data-page="' + (data.page + 1) + '"' + (data.page >= data.totalPages ? ' disabled' : '') + '>下一页</button>';
}

// 把当前生效的条件写成一句人话，并给一个一键清除的入口
function renderHint() {
  const parts = [];
  if (state.keyword) parts.push('关键词“' + state.keyword + '”');
  if (state.category !== 'all') {
    const found = categories.find((item) => item.key === state.category);
    parts.push('分类：' + (found ? found.label : state.category));
  }
  if (state.price) parts.push('价格：' + findPriceRange(state.price).label);

  if (!parts.length) {
    el.searchHint.hidden = true;
    el.searchHint.innerHTML = '';
    return;
  }

  el.searchHint.innerHTML =
    '<span>正在看：' + escapeHtml(parts.join(' · ')) + '</span>' +
    '<button type="button" data-clear-filters>清除筛选</button>';
  el.searchHint.hidden = false;
}

function renderCategoryChips() {
  const total = categories.reduce((sum, item) => sum + item.count, 0);
  const items = [{ key: 'all', label: '全部', count: total }].concat(categories);

  el.categoryChips.innerHTML = items
    .map((item) => {
      return (
        '<button class="chip" type="button" data-category="' + item.key + '" aria-pressed="' + (state.category === item.key) + '">' +
          escapeHtml(item.label) +
          '<span class="chip-count">' + item.count + '</span>' +
        '</button>'
      );
    })
    .join('');
}

function renderPriceChips() {
  el.priceChips.innerHTML = PRICE_RANGES.map((item) => {
    return (
      '<button class="chip" type="button" data-price="' + item.key + '" aria-pressed="' + (state.price === item.key) + '">' +
        escapeHtml(item.label) +
      '</button>'
    );
  }).join('');
}

/* ======================= 三、发请求 ======================= */

async function loadBase() {
  try {
    categories = await api.products.categories();
    renderCategoryChips();
    renderPriceChips();
  } catch (error) {
    // 分类拿不到时，商品列表仍可以按关键词加载，所以只提示、不中断
    toast(error.message || '分类加载失败', 'error');
  }
}

async function loadProducts(options) {
  const scroll = Boolean(options && options.scroll);
  const seq = (requestSeq += 1);

  el.grid.setAttribute('aria-busy', 'true');
  el.empty.hidden = true;
  renderSkeleton();

  const price = findPriceRange(state.price);

  try {
    const data = await api.products.list({
      keyword: state.keyword,
      category: state.category,
      minPrice: price.minPrice,
      maxPrice: price.maxPrice,
      sort: state.sort,
      page: state.page,
      pageSize: PAGE_SIZE
    });

    if (seq !== requestSeq) return;

    // 筛选后页码可能越界：自动退回最后一页，而不是显示空白
    if (!data.list.length && data.total > 0 && data.page > data.totalPages) {
      state.page = data.totalPages;
      return loadProducts({ scroll });
    }

    writeStateToUrl();
    renderGrid(data.list);
    renderCount(data);
    renderPagination(data);
    renderHint();
    if (scroll) scrollToList();
  } catch (error) {
    if (seq !== requestSeq) return;
    renderError(error);
  } finally {
    if (seq === requestSeq) el.grid.setAttribute('aria-busy', 'false');
  }
}

function scrollToList() {
  if (!el.list) return;
  const headerH = Number(getComputedStyle(document.documentElement).getPropertyValue('--header-h').replace('px', '')) || 84;
  const top = el.list.getBoundingClientRect().top + window.scrollY - headerH - 16;
  window.scrollTo({ top, behavior: 'smooth' });
}

/* ======================= 四、交互 ======================= */

function applyFilter(patch) {
  Object.assign(state, patch, { page: 1 });
  renderCategoryChips();
  renderPriceChips();
  el.sortSelect.value = state.sort;
  loadProducts({ scroll: true });
}

function clearFilters() {
  state.keyword = '';
  state.category = 'all';
  state.price = '';
  state.sort = 'default';
  state.page = 1;

  const input = $('#searchInput');
  if (input) input.value = '';

  renderCategoryChips();
  renderPriceChips();
  el.sortSelect.value = 'default';
  loadProducts({ scroll: true });
}

async function handleAdd(button) {
  const id = button.dataset.add;
  if (!id || button.disabled) return;

  const originalHtml = button.innerHTML;
  button.disabled = true;

  try {
    await cartStore.add(id, 1);
    button.innerHTML = ICONS.check;
    button.classList.add('is-added');
    toast('已加入购物车，右侧抽屉里可以改数量', 'success', 1800);

    setTimeout(() => {
      button.innerHTML = originalHtml;
      button.classList.remove('is-added');
    }, 1300);
  } catch (error) {
    toast(error.message || '加入购物车失败', 'error');
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  el.grid.addEventListener('click', (event) => {
    const addBtn = event.target.closest('[data-add]');
    if (addBtn) handleAdd(addBtn);
  });

  el.categoryChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (chip) applyFilter({ category: chip.dataset.category });
  });

  el.priceChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-price]');
    if (chip) applyFilter({ price: chip.dataset.price });
  });

  el.sortSelect.addEventListener('change', (event) => {
    applyFilter({ sort: event.target.value });
  });

  el.pagination.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    loadProducts({ scroll: true });
  });

  el.empty.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-filters]')) clearFilters();
    if (event.target.closest('[data-retry]')) loadProducts();
  });

  el.searchHint.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-filters]')) clearFilters();
  });

  const resetBtn = $('#resetFilterBtn');
  if (resetBtn) resetBtn.addEventListener('click', clearFilters);
}

/* ======================= 五、启动 ======================= */

async function init() {
  syncHeaderHeight();
  readStateFromUrl();

  initCartDrawer();
  initCheckout();
  initAuthUI();
  initAgentPanel();
  bindCartBadge(cartStore);
  bindEvents();

  const input = $('#searchInput');
  if (input && state.keyword) input.value = state.keyword;
  el.sortSelect.value = state.sort;

  // 在这一页提交搜索不再跳转，直接改条件并重新请求
  bindHeaderSearch((keyword) => {
    state.keyword = keyword;
    state.page = 1;
    loadProducts({ scroll: true });
  });

  cartStore.init().catch(() => {});

  await loadBase();
  loadProducts();
}

init();
