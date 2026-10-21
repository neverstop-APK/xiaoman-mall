/**
 * 【文件作用】首页逻辑：分类入口、编辑推荐、商品列表、搜索 / 筛选 / 排序 / 分页
 * --------------------------------------------------------------------------
 * 这一页是整个项目里请求最多的一页，建议按下面的顺序读：
 *
 *   ① 初始化：initCartDrawer() / initCheckout() 先把购物车抽屉和结算弹窗装好
 *   ② loadBase()：一次性拿到 分类 + 推荐 + 商品总数，渲染首屏和分类入口
 *   ③ loadProducts()：把 state 里的条件拼成查询参数，发给 GET /api/products
 *   ④ 服务端返回 { list, total, page, pageSize, totalPages }，再用它渲染卡片和分页
 *
 * 为什么搜索 / 筛选 / 排序都交给服务端？
 * 因为接口文档里就是这么定义的（keyword / category / minPrice / maxPrice / sort / page / pageSize），
 * 前端只负责「收集条件 -> 发请求 -> 渲染结果」，商品从 26 件变成 2600 件也不用改前端。
 *
 * 【对应知识点】ES6 模块、async / await、事件委托、数组 map / join、URLSearchParams
 * 【对应考核点】3.2 首页、3.4 搜索、3.5 筛选、3.9 响应式
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

// 价格区间放在前端数组里，方便加一档；真正的过滤仍然在服务端做
const PRICE_RANGES = [
  { key: '', label: '全部价格' },
  { key: '0-99', label: '¥99 以下', minPrice: 0, maxPrice: 99 },
  { key: '100-299', label: '¥100–299', minPrice: 100, maxPrice: 299 },
  { key: '300-499', label: '¥300–499', minPrice: 300, maxPrice: 499 },
  { key: '500-', label: '¥500 以上', minPrice: 500, maxPrice: '' }
];

const SORT_KEYS = ['default', 'price-asc', 'price-desc', 'sales-desc', 'rating-desc', 'newest'];

// 页面的全部筛选条件都放在这一个对象里：想改条件就改它，再调 loadProducts()
const state = {
  keyword: '',
  category: 'all',
  price: '',
  sort: 'default',
  page: 1
};

let categories = [];
// 请求序号：只认最后一次请求的结果，避免快速输入时旧结果覆盖新结果
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
  sortSelect: $('#sortSelect'),
  categoryGrid: $('#categoryGrid'),
  recommendRow: $('#recommendRow'),
  recentSection: $('#recent'),
  recentRow: $('#recentRow'),
  recentClearBtn: $('#recentClearBtn'),
  heroCovers: [$('#heroCover1'), $('#heroCover2'), $('#heroCover3')],
  statProducts: $('#statProducts'),
  statCategories: $('#statCategories')
};

/* ======================= 一、条件与地址栏 ======================= */

function findPriceRange(key) {
  return PRICE_RANGES.find((item) => item.key === key) || PRICE_RANGES[0];
}

// 打开页面时先读地址栏，这样刷新、或者把链接发给别人，都能看到同样的筛选结果
function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.keyword = (params.get('keyword') || '').trim();
  state.category = params.get('category') || 'all';
  const price = params.get('price') || '';
  state.price = PRICE_RANGES.some((item) => item.key === price) ? price : '';
  const sort = params.get('sort') || 'default';
  state.sort = SORT_KEYS.includes(sort) ? sort : SORT_KEYS[0];
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
  const url = window.location.pathname + (query ? '?' + query : '') + '#list';
  // replaceState 只改地址栏，不会像 location.href 那样触发页面刷新
  window.history.replaceState(null, '', url);
}

/* ======================= 二、渲染：商品卡片 ======================= */

function renderSkeleton() {
  el.grid.innerHTML = Array.from(
    { length: PAGE_SIZE },
    () => '<div class="skeleton skeleton-card"></div>'
  ).join('');
}

function renderEmptyState(options) {
  const action = options.action || '';
  el.empty.innerHTML =
    '<span class="empty-emoji" aria-hidden="true">' + options.emoji + '</span>' +
    '<span class="empty-title">' + escapeHtml(options.title) + '</span>' +
    '<span class="text-sm">' + escapeHtml(options.text) + '</span>' +
    action;
  el.empty.hidden = false;
  el.pagination.innerHTML = '';
}

function renderGrid(list) {
  el.grid.innerHTML = list.map((product) => cardHtml(product)).join('');
  el.empty.hidden = list.length > 0;

  if (!list.length) {
    renderEmptyState({
      emoji: '🔍',
      title: '没有找到符合条件的商品',
      text: '换个关键词，或者把价格区间放宽一点试试。',
      action: '<button class="btn btn-ghost" type="button" data-clear-filters>清除全部筛选</button>'
    });
  }
}

function renderError(error) {
  el.grid.innerHTML = '';
  renderEmptyState({
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

  // 只显示 5 个页码，当前页尽量放中间，避免 20 页时排出一长条按钮
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

// 搜索提示条：把当前生效的条件用人话写出来，并提供一键清除
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

/* ======================= 三、渲染：分类与推荐 ======================= */

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

function renderCategoryGrid() {
  el.categoryGrid.innerHTML = categories
    .map((item) => {
      return (
        '<button class="category-card" type="button" data-category="' + item.key + '">' +
          '<span class="category-emoji" aria-hidden="true">' + item.emoji + '</span>' +
          '<span class="category-name">' + escapeHtml(item.label) + '</span>' +
          '<span class="category-desc text-sm">' + escapeHtml(item.desc || '') + '</span>' +
          '<span class="category-meta text-xs">' + item.count + ' 件商品</span>' +
        '</button>'
      );
    })
    .join('');
}

function renderRecommend(list) {
  el.recommendRow.innerHTML = list
    .map((product) => cardHtml(product, 'recommend-card'))
    .join('');

  // 首屏右侧的三张图借用推荐商品的封面，省掉额外的图片请求
  el.heroCovers.forEach((img, index) => {
    const product = list[index];
    if (img && product) {
      img.src = product.cover;
      img.alt = '';
    }
  });
}

/* ======================= 四、发请求 ======================= */

async function loadBase() {
  try {
    const [categoryList, recommendList, all] = await Promise.all([
      api.products.categories(),
      api.products.recommendations(),
      api.products.list({ pageSize: 1 })
    ]);

    categories = categoryList;
    el.statProducts.textContent = String(all.total);
    el.statCategories.textContent = String(categoryList.length);

    renderCategoryChips();
    renderPriceChips();
    renderCategoryGrid();
    renderRecommend(recommendList);
  } catch (error) {
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
    // 这里就是接口文档里的 GET /api/products 查询参数
    const data = await api.products.list({
      keyword: state.keyword,
      category: state.category,
      minPrice: price.minPrice,
      maxPrice: price.maxPrice,
      sort: state.sort,
      page: state.page,
      pageSize: PAGE_SIZE
    });

    // 已经有更新的请求了，这次结果直接丢掉
    if (seq !== requestSeq) return;

    // 页码可能越界（比如筛选后只剩 2 件，却还停在第 4 页）
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

/* ======================= 五、交互 ======================= */

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

// 加入购物车：按钮先禁用，成功后短暂变成对勾，失败用 toast 说明原因
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
  // 事件委托：卡片是动态渲染的，把监听器挂在父容器上更省事
  el.grid.addEventListener('click', (event) => {
    const addBtn = event.target.closest('[data-add]');
    if (addBtn) handleAdd(addBtn);
  });

  el.recommendRow.addEventListener('click', (event) => {
    const addBtn = event.target.closest('[data-add]');
    if (addBtn) handleAdd(addBtn);
  });

  if (el.recentRow) {
    el.recentRow.addEventListener('click', (event) => {
      const addBtn = event.target.closest('[data-add]');
      if (addBtn) handleAdd(addBtn);
    });
  }

  el.categoryChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (chip) applyFilter({ category: chip.dataset.category });
  });

  el.categoryGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-category]');
    if (card) applyFilter({ category: card.dataset.category });
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

  // 空状态里的清除筛选 / 重新加载是动态插入的，同样用委托
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

/* ======================= 五、最近看过 ======================= */

const RECENT_KEY = 'xm_recent_products';

function readRecentIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((id) => typeof id === 'string').slice(0, 6);
  } catch (error) {
    return [];
  }
}

function renderRecent(list) {
  if (!el.recentSection || !el.recentRow) return;
  el.recentRow.innerHTML = list.map((product) => cardHtml(product, 'recommend-card')).join('');
  el.recentSection.hidden = list.length === 0;
}

async function loadRecent() {
  const ids = readRecentIds();
  if (!ids.length) return;

  // 单件商品可能已下架，用 allSettled 忽略失败项，不影响整块
  const results = await Promise.allSettled(ids.map((id) => api.products.detail(id)));
  const list = results.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  renderRecent(list);
}

function bindRecent() {
  if (!el.recentClearBtn) return;
  el.recentClearBtn.addEventListener('click', () => {
    localStorage.removeItem(RECENT_KEY);
    renderRecent([]);
    toast('已清空最近看过', 'success', 1600);
  });
}

/* ======================= 六、启动 ======================= */

function init() {
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

  bindHeaderSearch((keyword) => {
    state.keyword = keyword;
    state.page = 1;
    loadProducts({ scroll: true });
  });

  // 购物车初始化失败不影响逛商品，所以单独 catch
  cartStore.init().catch(() => {});

  loadBase();
  loadProducts();
  bindRecent();
  loadRecent();
}

init();
