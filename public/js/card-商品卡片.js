/**
 * 【文件作用】商品卡片：把一件商品渲染成 HTML 字符串（首页列表、推荐位、详情页推荐共用）
 * --------------------------------------------------------------------------
 * 为什么单独抽一个文件？
 * 首页、详情页都要画"商品卡片"。如果每个页面各写一份，
 * 以后改卡片上的字段（比如加一个"包邮"标签）就得改两三个地方，很容易漏。
 * 抽出来之后只改这里，所有页面一起变。
 *
 * 注意：这里只负责「拼 HTML 字符串」，不负责往页面上放。
 * 调用方拿到字符串后自己决定 innerHTML 到哪个容器。
 *
 * 【对应知识点】函数复用、模板字符串的替代写法（字符串拼接）、escapeHtml 防注入
 * 【对应考核点】3.3 商品卡片字段：图片 / 名称 / 价格 / 简介 / 分类
 */
import { formatMoney } from './api-请求封装.js';
import { escapeHtml } from './ui-通用界面工具.js';

export function productHref(id) {
  return './product-商品详情页.html?id=' + encodeURIComponent(id);
}

export function stockTag(product) {
  if (product.stock <= 0) return '<span class="stock-tag is-out">已售罄</span>';
  if (product.stock <= 5) return '<span class="stock-tag is-low">仅剩 ' + product.stock + ' 件</span>';
  return '';
}

/**
 * @param {object} product 商品对象（来自 /api/products 的 list 里的一项）
 * @param {string} [extraClass] 额外 class，比如详情页用 'recommend-card'
 */
export function cardHtml(product, extraClass) {
  const soldOut = product.stock <= 0;
  const href = productHref(product.id);
  const name = escapeHtml(product.name);

  const tags = (product.tags || [])
    .slice(0, 2)
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');

  const original = product.originalPrice
    ? '<span class="price-strike">' + formatMoney(product.originalPrice) + '</span>'
    : '';

  return (
    '<article class="card ' + (extraClass || '') + '">' +
      '<a class="card-media" href="' + href + '" aria-label="查看 ' + name + ' 的详情">' +
        '<img src="' + escapeHtml(product.cover) + '" alt="' + name + '" width="800" height="600" loading="lazy" decoding="async">' +
        stockTag(product) +
      '</a>' +
      '<div class="card-body">' +
        '<span class="card-cat">' + escapeHtml(product.category) + ' · ' + escapeHtml(product.brand) + '</span>' +
        '<h3 class="card-title"><a href="' + href + '">' + name + '</a></h3>' +
        '<p class="card-summary">' + escapeHtml(product.summary) + '</p>' +
        '<div class="tag-row">' + tags + '</div>' +
        '<div class="card-foot">' +
          '<div class="price-row">' +
            '<span class="price">' + formatMoney(product.price) + '</span>' + original +
          '</div>' +
          '<button class="add-btn" type="button" data-add="' + product.id + '" aria-label="把 ' + name + ' 加入购物车"' + (soldOut ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</article>'
  );
}
