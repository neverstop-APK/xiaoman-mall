/**
 * 【文件作用】生成商品封面图（26 张 SVG）
 * ------------------------------------------------------------
 * 为什么用脚本生成，而不是找网图？
 *   1. 离线可用，不依赖任何图床，打开就能跑；
 *   2. 不会因为外链失效出现一张张裂图；
 *   3. SVG 是矢量图，50%–250% 缩放都清晰，正好配合响应式要求。
 *
 * 每个商品用一种"分类主色"，同一个商品每次生成的图完全一样
 * （用商品 id 做随机种子，而不是每次 Math.random），这样不同电脑上结果一致。
 *
 * 运行方式：node scripts/gen-covers-生成商品封面.js
 *
 * 【对应知识点】Node.js fs / path、模板字符串、哈希函数
 * 【对应考核点】3.3 商品列表需要图片
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'products');
const DATA_FILE = path.join(ROOT, 'server', 'data', 'products-商品数据.json');

// 每个分类一组配色：[底色, 装饰色, 文字色]
const PALETTE = {
  数码: ['#e8eefb', '#c3d3f5', '#1f3a6e'],
  家居: ['#f7ece2', '#efd3bb', '#6b3f22'],
  文具: ['#eef1e4', '#d8e0c2', '#43522c'],
  户外: ['#e3f0e6', '#bfdcc7', '#245038'],
  服饰: ['#f3e9ee', '#e3c9d6', '#5c2f45'],
  配件: ['#ece9f3', '#d3cceb', '#3d3462']
};

// 简单的字符串哈希：同样的输入永远得到同样的数字
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// 用哈希做伪随机数，保证每次生成结果一致
function seeded(seed) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

/** 文件名里不能有空格和特殊字符，统一处理一下 */
function safeName(text) {
  return text.replace(/[\s\\/:*?"<>|]/g, '');
}

function buildSvg(product) {
  const [bg, deco, ink] = PALETTE[product.category] || PALETTE.数码;
  const rand = seeded(hash(product.id));
  const x1 = 540 + rand() * 160;
  const y1 = 90 + rand() * 120;
  const x2 = 60 + rand() * 120;
  const y2 = 400 + rand() * 110;
  const rotate = -12 + rand() * 24;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img" aria-label="${product.name}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect width="800" height="600" fill="url(#bg)"/>
  <circle cx="${x1.toFixed(0)}" cy="${y1.toFixed(0)}" r="150" fill="${deco}" opacity="0.75" filter="url(#soft)"/>
  <circle cx="${x2.toFixed(0)}" cy="${y2.toFixed(0)}" r="190" fill="${deco}" opacity="0.45" filter="url(#soft)"/>

  <circle cx="400" cy="300" r="210" fill="#ffffff" opacity="0.38"/>

  <g transform="rotate(${rotate.toFixed(1)} 400 300)">
    <text x="400" y="366" text-anchor="middle" font-size="220" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${product.emoji}</text>
  </g>
</svg>
`;
}

const products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });

const patched = products.map((product) => {
  const file = safeName(product.id + '-' + product.name).slice(0, 44) + '.svg';
  fs.writeFileSync(path.join(OUT_DIR, file), buildSvg(product), 'utf8');
  // 把封面路径写回商品数据，前端直接用 product.cover 就行
  return { ...product, cover: '/assets/products/' + encodeURI(file) };
});

fs.writeFileSync(DATA_FILE, JSON.stringify(patched, null, 2), 'utf8');
console.log('已生成 ' + patched.length + ' 张封面图 -> public/assets/products/');
console.log('示例：' + patched[0].cover);
