# 小满商城 · 前端项目考核作品

一个可以完整走通「逛 → 搜 → 筛 → 看详情 → 加购 → 改数量 → 结算 → 支付 → 查订单」的购物网站。

- 前端：原生 HTML5 + CSS3 + ES6 模块，没有框架、没有构建步骤；
- 后端：Node.js 原生 `http` 模块，零第三方依赖；
- 数据：26 件商品存在 JSON 文件里，由后端读取，前端只通过接口拿数据；
- 设计：暖白底色 + 陶土红点缀，衬线标题，卡片式布局，桌面/平板/手机三档响应式。

![首页](docs/screenshots/home.png)

## 目录

1. [怎么跑起来](#一怎么跑起来)
2. [功能与考核点对照](#二功能与考核点对照)
3. [目录结构](#三目录结构)
4. [三条关键链路](#四三条关键链路)
5. [接口一览](#五接口一览)
6. [数据是怎么放的](#六数据是怎么放的)
7. [响应式是怎么做的](#七响应式是怎么做的)
8. [出错了怎么查](#八出错了怎么查)
9. [还没做的部分](#九还没做的部分)

## 一、怎么跑起来

### 环境

- Node.js 18 或更高版本（开发时用的是 Node 24）
- 任意现代浏览器（Chrome / Edge / Firefox / Safari）

### 启动（三种方式，任选一种）

**方式一：双击启动（最简单）**

在项目文件夹里双击 `启动商城.bat`。它会检查 Node.js、启动服务，并自动打开浏览器；关闭弹出的命令行窗口就停止服务。

**方式二：命令行（推荐，不依赖 npm）**

```bash
cd D:\dsh-market-model\xiaoman-mall
node server/index-服务入口.js
```

**方式三：npm**

```bash
cd D:\dsh-market-model\xiaoman-mall
npm start
```

终端出现下面这行就成功了：

```
小满商城已启动：http://127.0.0.1:3000
```

浏览器打开 `http://127.0.0.1:3000` 即可。想换端口：

```bash
# Windows PowerShell
$env:PORT=4000; node server/index-服务入口.js
# macOS / Linux
PORT=4000 node server/index-服务入口.js
```

### 网址打不开？按这个顺序检查

1. **终端有没有显示「小满商城已启动」**：没有就是服务没起来，先看终端里的报错；
2. **命令是不是在 `xiaoman-mall` 目录执行的**：在 `D:\dsh-market-model` 下执行会报找不到 package.json；
3. **提示 `node 不是内部或外部命令`**：说明 Node.js 没装或没进 PATH，去装 Node.js 18+；
4. **命令行窗口被关掉了**：服务跟着停，重新启动即可；
5. **3000 端口被占用**：换端口启动，再访问 `http://127.0.0.1:4000`；
6. **换一个地址试**：先试 `http://localhost:3000`，再试 `http://127.0.0.1:3000`；
7. **代理 / VPN / 安全软件**可能拦截本地地址，临时关闭再试。

> 商品封面是 `scripts/gen-covers-生成商品封面.js` 生成的 SVG，已经提交到仓库，正常启动不需要重新生成。
> 只有想改配色或重新生成时才执行 `npm run covers`。

## 二、功能与考核点对照

| 考核要求 | 实现情况 | 在哪里 |
| --- | --- | --- |
| 3.2 导航栏、图标悬浮效果 | ✅ 三个导航图标 + 购物车，hover 上浮变色 | `public/index-首页.html`、`css/layout-导航与页面布局.css` |
| 3.2 商品推荐 | ✅ 按销量取 4 件，横向卡片 | `server/services/catalog-商品查询服务.js` |
| 3.2 商品列表 | ✅ 8 件一页，分页器 | `public/js/home-首页逻辑.js` |
| 3.2 分类入口 | ✅ 6 个分类卡片，点击即筛选 | 同上 |
| 3.2 搜索入口 | ✅ 顶部搜索框，回车或点按钮 | `public/js/ui-通用界面工具.js` |
| 3.2 购物车入口 | ✅ 右上角图标 + 数量角标 | `public/js/store-购物车状态.js` |
| 3.3 列表字段 | ✅ 图片、名称、价格、简介、标签、分类 | `public/js/card-商品卡片.js` |
| 3.4 按名称/关键词搜索 | ✅ 匹配名称、品牌、简介、标签、搜索词 | `server/services/catalog-商品查询服务.js` |
| 3.5 至少一种筛选 | ✅ 分类 + 价格区间，可叠加，可排序 | `public/js/home-首页逻辑.js` |
| 3.6 商品详情 | ✅ 名称、图片、价格、介绍、分类、库存、加购 | `public/product-商品详情页.html` |
| 3.7 侧拉式购物车 | ✅ 添加、删除、改数量、单项小计、总金额、清空 | `public/js/cartdrawer-购物车抽屉.js` |
| 3.8 下单与结果页 | ✅ 订单号、商品、数量、单价、总价、时间、状态 | `public/js/checkout-结算下单.js`、`public/js/orders-订单页逻辑.js` |
| 3.9 响应式 | ✅ flex + 媒体查询 + clamp/rem，50%–250% 缩放不横向溢出 | `public/css/*.css` |
| 4 商品/订单接口 | ✅ 列表、详情、下单、查单、支付、取消 | `server/routes/` |
| 5 15–30 件差异化商品 | ✅ 26 件、6 个分类、价格 19–1699 | `server/data/products-商品数据.json` |
| 5 商品数据不能全硬编码在前端 | ✅ 全部来自接口，前端只留渲染模板 | 同上 |
| 8 注册/登录（进阶，推荐） | ⬜ 本期未做，见「还没做的部分」 | - |
| 9 AI Agent（特别加分） | ⬜ 本期未做 | - |

## 三、目录结构

文件名的中文部分就是它的作用，比如 `cart-购物车服务.js` 一眼能看出是购物车业务。

每个文件具体做什么、一次请求怎么走、用到了哪些知识点，另有一份图文版 [文件说明书（PDF）](docs/小满商城-文件说明书.pdf)。

每个文件夹里还放了一张 `说明-这个文件夹装什么.md`：打开任意目录，第一眼就能知道这个文件夹负责什么、里面有哪些文件、和上下游怎么配合。下面的目录树和速查表是同样内容的汇总。

想按顺序把代码读一遍，看 [阅读路线：从跑起来到讲清楚](docs/阅读路线-从跑起来到讲清楚.md)：从当用户、读契约，到两条链路、自测改动，共 7 站。

```
xiaoman-mall/
├─ server/                        后端（只在 Node 里运行）
│  ├─ index-服务入口.js            启动 HTTP 服务，分发 /api 与静态文件
│  ├─ router-迷你路由.js           极简路由：注册路径、解析参数、统一错误处理
│  ├─ data/                        数据表：商品/分类只读，购物车/订单运行时生成
│  │  ├─ products-商品数据.json     26 件商品
│  │  ├─ categories-商品分类.json   6 个分类
│  │  ├─ carts-购物车数据.json      运行时生成
│  │  └─ orders-订单数据.json       运行时生成
│  ├─ lib/                         通用工具：响应格式、JSON 存储、静态文件
│  │  ├─ response-统一响应格式.js   ok / fail / HttpError / sendJson
│  │  ├─ store-JSON数据存储.js      读写 JSON、内存缓存、按表名找文件
│  │  └─ static-静态文件服务.js     返回 HTML/CSS/JS/SVG，处理 404 与 304
│  ├─ services/                   业务规则都在这层
│  │  ├─ catalog-商品查询服务.js    搜索、筛选、排序、分页、推荐
│  │  ├─ cart-购物车服务.js         加购、改数量、删除、清空、算金额
│  │  └─ orders-订单服务.js         下单、算运费、扣库存、支付、取消
│  └─ routes/                     HTTP 与 service 之间的薄薄一层
│     ├─ products-商品接口.js
│     ├─ cart-购物车接口.js
│     └─ orders-订单接口.js
├─ public/                        前端（浏览器直接打开这些文件）
│  ├─ index-首页.html
│  ├─ product-商品详情页.html
│  ├─ orders-我的订单页.html
│  ├─ 404-页面不存在.html
│  ├─ css/                        按「基础 → 布局 → 组件 → 页面 → 补充」分层
│  ├─ js/                         一个文件一件事，用 ES Module 互相引用
│  │  ├─ api-请求封装.js           所有 fetch 都在这里，统一超时和报错
│  │  ├─ store-购物车状态.js       购物车状态 + 订阅通知
│  │  ├─ ui-通用界面工具.js        toast、抽屉、弹窗、图标、防抖
│  │  ├─ card-商品卡片.js          卡片 HTML 模板（首页和详情页共用）
│  │  ├─ home-首页逻辑.js          首页的加载、筛选、分页
│  │  ├─ product-详情页逻辑.js     详情页的数量选择与加购
│  │  ├─ cartdrawer-购物车抽屉.js  侧拉购物车的渲染与操作
│  │  ├─ checkout-结算下单.js      收货信息校验、下单、模拟支付
│  │  └─ orders-订单页逻辑.js      结果页与历史订单
│  └─ assets/products/            26 张商品封面 SVG
├─ scripts/                       开发脚本：生成商品封面
│  └─ gen-covers-生成商品封面.js
├─ 启动商城.bat                    双击启动：检查 Node、开服务、开浏览器
├─ package.json
├─ README.md
└─ docs/                          接口文档、阅读路线、演示脚本、截图、PDF 文件说明书
```


### 文件夹速查

| 文件夹 | 大概装什么 | 进去先看 |
| --- | --- | --- |
| `server/` | 后端全部代码：入口、路由、接口、服务、数据、工具 | `index-服务入口.js` |
| `server/data/` | 四张 JSON 表：商品、分类、购物车、订单 | `products-商品数据.json` |
| `server/lib/` | 与业务无关的工具：统一响应、JSON 存储、静态文件 | `response-统一响应格式.js` |
| `server/routes/` | 14 个 HTTP 接口，只取参数、调服务、返回 | `products-商品接口.js` |
| `server/services/` | 搜索筛选、购物车、订单金额与库存的规则 | `catalog-商品查询服务.js` |
| `public/` | 4 个页面 + CSS/JS/图片，浏览器直接加载 | `index-首页.html` |
| `public/css/` | 5 层样式：基础、布局、组件、页面、补充 | `base-设计变量与基础样式.css` |
| `public/js/` | 9 个 ES Module：请求、状态、模板、组件、页面入口 | `api-请求封装.js` |
| `public/assets/` | 静态资源，目前是商品封面 | `products/` |
| `public/assets/products/` | 26 张商品封面 SVG，脚本生成 | 任意一张 SVG |
| `docs/` | PDF 说明书、阅读路线、接口文档、演示脚本、截图 | `小满商城-文件说明书.pdf` |
| `docs/screenshots/` | 8 张界面截图，README 和 PDF 引用 | `home.png` |
| `scripts/` | 开发时手动跑的工具：生成商品封面 | `gen-covers-生成商品封面.js` |

## 四、三条关键链路

### 1. 搜索 / 筛选（前端只传条件，后端负责算）

```
用户点「数码」或输入「耳机」
  → home-首页逻辑.js 更新内存里的 state，并同步到地址栏 ?category=数码&keyword=耳机
  → api.products.list(state) 拼出 /api/products?category=...&keyword=...&page=1&pageSize=8
  → catalog-商品查询服务.js：先按关键词过滤，再按分类过滤，再按价格过滤，最后排序 + 分页
  → 返回 { list, total, totalPages }
  → 首页重新渲染卡片和分页器，滚动到列表区
```

每个请求都带一个自增的 `requestSeq`：如果用户连续快速点击，只有最后一次请求的结果会被渲染，避免旧结果覆盖新结果。

### 2. 加入购物车（状态放在服务端，前端只做展示）

```
点「加入购物车」
  → cartStore.add(productId, quantity)
  → POST /api/cart/items { cartId, productId, quantity }
  → 服务端找到购物车（没有就新建），检查库存，累加数量
  → 返回整辆购物车的最新快照 { items, totalQuantity, totalAmount }
  → cartStore 把快照存进 state，通知所有订阅者
  → 顶栏角标、侧拉抽屉、结算弹窗同时更新（它们订阅的是同一份状态）
```

为什么购物车放服务端？因为下单必须由服务端重新校验库存和价格，如果购物车只存在浏览器里，前端传什么价就是什么价，不安全，也不好解释「服务端职责」。

### 3. 下单 + 模拟支付

```
点「去结算」→ 填收货人/手机号/地址 → 提交
  → 前端先做格式校验（手机号 /^1[3-9]\d{9}$/，地址至少 5 个字）
  → POST /api/orders { cartId, receiver, remark }
  → 服务端重新读购物车、校验库存、按数据库单价重算金额、生成订单号
  → 返回 201 和新订单
  → 前端调用 POST /api/orders/:id/pay（这里故意停 900ms，模拟支付过程）
  → 订单号写进 localStorage，跳转 orders-我的订单页.html?id=订单号
  → 结果页 GET /api/orders/:id 渲染「支付成功」、商品明细、金额、收货信息
```

金额和订单号都由服务端决定，前端只负责展示——这是「后端职责」最直接的例子。

## 五、接口一览

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/products` | 商品列表，支持 keyword/category/minPrice/maxPrice/sort/page/pageSize |
| GET | `/api/products/:id` | 商品详情 |
| GET | `/api/products/:id/related` | 相关推荐 |
| GET | `/api/categories` | 分类 + 每类数量 |
| GET | `/api/recommendations` | 首页推荐 |
| GET | `/api/cart` | 读取购物车 |
| POST | `/api/cart/items` | 加购 |
| PATCH | `/api/cart/items/:productId` | 改数量 |
| DELETE | `/api/cart/items/:productId` | 删除单项 |
| DELETE | `/api/cart` | 清空 |
| POST | `/api/orders` | 创建订单 |
| GET | `/api/orders/:id` | 订单详情 |
| POST | `/api/orders/:id/pay` | 模拟支付 |
| POST | `/api/orders/:id/cancel` | 取消订单 |

完整的参数、响应示例和错误码表见 [docs/接口文档-前后端约定.md](docs/接口文档-前后端约定.md)。

## 六、数据是怎么放的

- `products-商品数据.json`：26 件商品，字段包括 id、名称、品牌、分类、价格、原价、库存、评分、销量、标签、简介、详细介绍、卖点数组、上架时间；
- `categories-商品分类.json`：6 个分类，分类名同时是商品里的 `category` 字段；
- `carts-购物车数据.json` / `orders-订单数据.json`：第一次写入时自动创建；删掉也不影响启动；
- 服务启动后会把 JSON 读进内存，写操作先改内存再落盘，所以读接口很快；
- 商品价格、库存只在服务端信源里，订单金额由服务端重算。

## 七、响应式是怎么做的

- 布局用 flex 和 `grid`（`minmax(min(100%, 240px), 1fr)`），卡片能自动换行；
- 字号、间距用 `clamp()` 和 rem，而不是固定 px；
- 断点：`960px` 详情页改单列、`860px` 隐藏导航文字只留图标、`640px` 卡片单列/订单项换行、`400px` 进一步缩小间距；
- 缩放到 250%（等效视口约 576px）时商品网格为 3 列，页面没有横向滚动条。

## 八、出错了怎么查

1. **接口 404**：看 Network 里请求路径是不是 `/api/...`，是不是把 `GET` 写成了 `POST`；
2. **400**：看 Response 的 `code`，40011 是价格参数、40021 是数量、40031 是空购物车；
3. **409**：库存或订单状态冲突，`message` 里写了具体原因；
4. **Failed to fetch**：服务没启动、端口不对，或者直接双击打开了 HTML 文件（必须用 `http://` 访问）；
5. **页面样式不对**：先强制刷新（Ctrl+F5），确认 CSS 路径大小写一致；
6. 服务端终端会打印每条请求的方法、路径、状态码、耗时，前后端对照时间即可。

## 九、还没做的部分

- 注册 / 登录 / 登录态（考核 8 的进阶项）：需要用户表、密码哈希、会话或 JWT，以及「我的订单」按用户隔离；
- AI Agent 导购（考核 9 的特别加分）：对话、工具调用、多轮约束、流式输出等，本期按计划先不做；
- 订单列表接口：目前历史订单靠 localStorage 里的订单号逐个查询，后续可以加 `GET /api/orders?phone=...`；
- 真实支付、图片上传、商品管理后台。

## 十、开发与验证方式

- 先定接口和数据结构，再写服务层，最后写页面，前端只依赖接口文档；
- 每完成一个页面，用浏览器逐条走主流程，并用 DevTools 的 Network / Console 检查请求与报错；
- 用无头浏览器跑过一遍完整链路（加购 → 改数量 → 结算 → 支付 → 查单）、390px 手机视口和 250% 缩放，确认没有 console 报错和横向溢出；
- 代码按「一个文件一件事」拆分，文件名直接写中文作用，方便回看和讲给别人听。
