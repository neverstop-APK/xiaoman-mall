// 404 页自己的逻辑：只接管页头搜索框。
// 单独成文件是为了配合 Nginx 的 CSP（script-src 'self'，不允许内联脚本）。
import { bindHeaderSearch } from './ui-通用界面工具.js';

bindHeaderSearch((keyword) => {
  const query = keyword ? '?keyword=' + encodeURIComponent(keyword) : '';
  window.location.href = './products-全部商品页.html' + query;
});
