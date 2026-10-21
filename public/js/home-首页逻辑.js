/**
 * 【文件作用】首页逻辑：分类入口、本周热卖、编辑推荐、最近看过
 * --------------------------------------------------------------------------
 * 首页只负责“逛”：
 *   ① loadBase()  拿分类、推荐、商品总数，画分类入口和首屏统计
 *   ② loadHot()   拿销量前 8 件，画“本周热卖”
 *   ③ 搜索框不再在本页过滤，而是把关键词带到“全部商品页”
 *
 * 为什么把搜索 / 筛选 / 分页搬到单独一页？
 * 首页需要留位置给推荐和专题；完整的筛选工具放在目录页，两边都更清楚。
 * 商品数据仍然全部来自 GET /api/products，首页没有写死任何一件商品。
 *
 * 【对应知识点】ES6 模块、async / await、Promise.all、事件委托、URLSearchParams
 * 【对应考核点】3.2 首页、3.4 搜索入口、3.9 响应式
 */
import { api } from './api-请求封装.js';
import { cardHtml } from './card-商品卡片.js';
import { cartStore } from './store-购物车状态.js';
import { $, escapeHtml, toast, bindHeaderSearch, bindCartBadge, syncHeaderHeight, ICONS } from './ui-通用界面工具.js';
import { initCartDrawer } from './cartdrawer-购物车抽屉.js';
import { initCheckout } from './checkout-结算下单.js';
import { initAuthUI } from './authui-登录注册弹窗.js';
import { initAgentPanel } from './agent-购物助手面板.js';

const HOME_HOT_SIZE = 8;
const CATALOG_PAGE = './products-全部商品页.html';

const el = {
  hotGrid: $('#hotGrid'),
  hotEmpty: $('#hotEmpty'),
  categoryGrid: $('#categoryGrid'),
  recommendRow: $('#recommendRow'),
  recentSection: $('#recent'),
  recentRow: $('#recentRow'),
  recentClearBtn: $('#recentClearBtn'),
  heroCovers: [$('#heroCover1'), $('#heroCover2'), $('#heroCover3')],
  statProducts: $('#statProducts'),
  stockNote: $('#stockNote'),
  statCategories: $('#statCategories')
};

let categories = [];

/* ======================= 一、渲染 ======================= */

function renderCategoryGrid() {
  el.categoryGrid.innerHTML = categories
    .map((item) => {
      const available = item.available ?? item.count;
      const soldOut = item.count - available;
      const href = CATALOG_PAGE + '?category=' + encodeURIComponent(item.key);
      return (
        '<a class="category-card" href="' + href + '">' +
          '<span class="category-emoji" aria-hidden="true">' + item.emoji + '</span>' +
          '<span class="category-name">' + escapeHtml(item.label) + '</span>' +
          '<span class="category-desc text-sm">' + escapeHtml(item.desc || '') + '</span>' +
          '<span class="category-meta text-xs">' + item.count + ' 件商品' +
            (soldOut > 0 ? ' · ' + soldOut + ' 件售罄' : '') +
          '</span>' +
        '</a>'
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

function renderHotSkeleton() {
  el.hotGrid.innerHTML = Array.from(
    { length: HOME_HOT_SIZE },
    () => '<div class="skeleton skeleton-card"></div>'
  ).join('');
}

/* ======================= 二、发请求 ======================= */

async function loadBase() {
  try {
    const [categoryList, recommendList, all] = await Promise.all([
      api.products.categories(),
      api.products.recommendations(),
      api.products.list({ pageSize: 1 })
    ]);

    categories = categoryList;
    const total = all.total;
    const available = categoryList.reduce((sum, item) => sum + (item.available ?? item.count), 0);

    el.statProducts.textContent = String(total);
    el.statCategories.textContent = String(categoryList.length);
    if (el.stockNote) {
      el.stockNote.textContent = available < total
        ? '共 ' + total + ' 件，' + available + ' 件有货，' + (total - available) + ' 件已售罄'
        : '共 ' + total + ' 件，全部有货';
    }

    renderCategoryGrid();
    renderRecommend(recommendList);
  } catch (error) {
    toast(error.message || '首页内容加载失败', 'error');
  }
}

async function loadHot() {
  el.hotGrid.setAttribute('aria-busy', 'true');
  el.hotEmpty.hidden = true;
  renderHotSkeleton();

  try {
    // 只取销量前 8 件；完整目录由“查看全部”进入
    const data = await api.products.list({ sort: 'sales-desc', page: 1, pageSize: HOME_HOT_SIZE });
    el.hotGrid.innerHTML = data.list.map((product) => cardHtml(product)).join('');
    el.hotEmpty.hidden = data.list.length > 0;
  } catch (error) {
    el.hotGrid.innerHTML = '';
    el.hotEmpty.hidden = false;
    toast(error.message || '热卖商品加载失败', 'error');
  } finally {
    el.hotGrid.setAttribute('aria-busy', 'false');
  }
}

/* ======================= 三、加入购物车 ======================= */

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

function bindAddButtons() {
  [el.hotGrid, el.recommendRow, el.recentRow].forEach((container) => {
    if (!container) return;
    container.addEventListener('click', (event) => {
      const addBtn = event.target.closest('[data-add]');
      if (addBtn) handleAdd(addBtn);
    });
  });
}

/* ======================= 四、最近看过 ======================= */

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

/* ======================= 五、启动 ======================= */

function goCatalog(keyword) {
  const params = new URLSearchParams();
  const value = (keyword || '').trim();
  if (value) params.set('keyword', value);
  const query = params.toString();
  window.location.href = CATALOG_PAGE + (query ? '?' + query : '');
}

function init() {
  // 兼容旧链接：以前搜索结果是 index?keyword=...，现在统一带到目录页
  if (window.location.search) {
    window.location.replace(CATALOG_PAGE + window.location.search);
    return;
  }

  syncHeaderHeight();

  initCartDrawer();
  initCheckout();
  initAuthUI();
  initAgentPanel();
  bindCartBadge(cartStore);
  bindAddButtons();
  bindRecent();

  // 在首页提交搜索：不在这里过滤，而是跳到完整目录并带上关键词
  bindHeaderSearch(goCatalog);

  cartStore.init().catch(() => {});

  loadBase();
  loadHot();
  loadRecent();
}

init();
