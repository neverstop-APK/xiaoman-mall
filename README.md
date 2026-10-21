# 小满商城 · 前端项目考核作品

一个可以完整走通「逛 → 搜 → 筛 → 看详情 → 加购 → 改数量 → 结算 → 支付 → 查订单」的购物网站。

- 前端：原生 HTML5 + CSS3 + ES6 模块，没有框架、没有构建步骤；
- 后端：Node.js 原生 `http` 模块，零第三方依赖；
- 数据：26 件商品存在 JSON 文件里，由后端读取，前端只通过接口拿数据；
- 账号：注册、登录、退出、HttpOnly 会话，订单跟着账号走；
- AI：右下角「问问小满」购物助手，工具调用、多轮约束、确认后下单、SSE 流式；
- 设计：暖白底色 + 陶土红点缀，衬线标题，卡片式布局，桌面 / 平板 / 手机三档响应式；
- 页面分工：首页只放推荐、热卖和专题位，搜索、筛选、排序、分页集中在「全部商品」页。

![首页](docs/screenshots/home.png)

> 想先看「每个文件做什么、它们怎么连起来」，打开 [文件说明书（PDF，19 页）](docs/小满商城-文件说明书.pdf)。
> 想按顺序读代码，看 [阅读路线：从跑起来到讲清楚](docs/阅读路线-从跑起来到讲清楚.md)。

## 目录

1. [怎么跑起来](#一怎么跑起来)
2. [功能与考核点对照](#二功能与考核点对照)
3. [目录结构](#三目录结构)
4. [三条关键链路](#四三条关键链路)
5. [接口一览](#五接口一览)
6. [数据、测试与 AI 评测](#六数据测试与-ai-评测)
7. [登录态与 AI 助手](#七登录态与-ai-助手)
8. [响应式是怎么做的](#八响应式是怎么做的)
9. [部署到自己的服务器](#九部署到自己的服务器)
10. [出错了怎么查](#十出错了怎么查)
11. [AI Coding Process](#十一ai-coding-process)
12. [还没做的部分](#十二还没做的部分)

## 一、怎么跑起来

### 环境

- Node.js 18 或更高版本（开发时用的是 Node 24）
- 任意现代浏览器（Chrome / Edge / Firefox / Safari）

项目没有 npm 依赖，**不需要 `npm install`**。

### 启动（三种方式，任选一种）

**方式一：双击启动**

在项目文件夹里双击 `启动商城.bat`。它会检查 Node.js、启动服务，并自动打开浏览器；关闭弹出的命令行窗口就停止服务。

**方式二：命令行（推荐）**

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

浏览器打开 `http://127.0.0.1:3000`。想换端口：

```powershell
$env:PORT=4000; node server/index-服务入口.js
```

### 想跑测试

```bash
npm test              # 46 条：37 条单元测试 + 9 条真实 HTTP 集成测试
npm run test:unit     # 只跑单元测试
npm run test:api      # 只跑接口测试
node tests/eval/run-评测.mjs   # 30 条 AI 助手评测，生成 docs/AI评测报告.md
```

测试会用临时数据目录和独立端口，不会改动 `server/data`，也不需要联网。

### 网址打不开？按这个顺序检查

1. **终端有没有显示「小满商城已启动」**：没有就是服务没起来，先看终端报错；
2. **命令是不是在 `xiaoman-mall` 目录执行的**：在上一层执行会找不到入口文件；
3. **提示 `node 不是内部或外部命令`**：Node.js 没装或没进 PATH；
4. **命令行窗口被关掉了**：服务跟着停，重新启动即可；
5. **3000 端口被占用**：换端口启动，再访问 `http://127.0.0.1:4000`；
6. **Failed to fetch**：不要直接双击 HTML 文件，必须通过 `http://` 打开；
7. **代理 / VPN / 安全软件**可能拦截本地地址，临时关闭再试。

> 商品封面是 `scripts/gen-covers-生成商品封面.js` 生成的 SVG，已经提交到仓库，正常启动不需要重新生成。

## 二、功能与考核点对照

| 考核要求 | 实现情况 | 在哪里 |
| --- | --- | --- |
| 3.1 原生或框架、Git 仓库 | 原生 HTML/CSS/ESM；本地 Git 仓库，按约定暂未推 GitHub | 项目根目录 |
| 3.2 导航、图标悬浮、推荐、列表、分类、搜索、购物车入口 | 三个导航图标 + 账号 + 购物车；首页推荐 4 件、热卖 8 件；全部商品页每页 8 件；6 个分类；搜索框 | `public/index-首页.html`、`public/products-全部商品页.html` |
| 3.3 卡片字段 | 图片、名称、价格、简介、标签、分类 | `public/js/card-商品卡片.js` |
| 3.4 关键词搜索 | 匹配名称、品牌、简介、标签、搜索词，支持防抖与空态 | `server/services/catalog-商品查询服务.js` |
| 3.5 至少一种筛选 | 分类 + 价格区间，可叠加，五种排序，条件写进地址栏 | `public/js/products-全部商品页逻辑.js` |
| 3.6 商品详情 | 名称、图片、价格、原价、折扣、介绍、分类、库存、规格、加购 | `public/product-商品详情页.html` |
| 3.7 侧拉购物车 | 添加、删除、改数量、单项小计、总金额、清空、免运费进度 | `public/js/cartdrawer-购物车抽屉.js` |
| 3.8 下单与结果页 | 订单号、商品、数量、单价、总价、时间、状态、模拟支付、结果页 | `public/js/checkout-结算下单.js`、`public/js/orders-订单页逻辑.js` |
| 3.9 响应式 | flex + grid + 媒体查询 + clamp/rem；390px、250% 缩放验证无横向滚动 | `public/css/*.css` |
| 4 商品 / 订单接口 | 24 个 HTTP 接口，统一 `code / message / data` 信封 | `server/routes/` |
| 5 15–30 件差异化商品、不能全硬编码前端 | 26 件、6 个分类、价格 19–1699；其中 1 件库存 0 用于演示售罄，首页标注“26 件总数 / 25 件有货”；全部来自接口 | `server/data/products-商品数据.json` |
| 6 讲清后端职责、请求流程、错误排查 | 第 3、4 节 + PDF 第 3、7 章 + 接口文档 | `docs/接口文档-前后端约定.md` |
| 7 Prompt Engineering 加分 | 提示词、工具定义、失败案例与复盘 | `docs/Prompt-Engineering与AI协作.md` |
| 8 注册 / 登录 / 退出 / 登录态 | scrypt 加盐哈希、HttpOnly Cookie、订单按用户隔离 | `server/services/auth-用户认证服务.js` |
| 9.1 对话 | 悬浮面板、SSE 流式、富消息 | `server/agent/`、`public/js/agent-购物助手面板.js` |
| 9.2 searchProducts 工具 | 8 个工具，统一 `{ ok, data, summary }` 返回 | `server/agent/tools-工具集.js` |
| 9.3 多轮与「便宜一点」 | 保留上一轮品类与关键词，以第一件价格为参照 | `server/agent/localbrain-本地规则引擎.js` |
| 9.4 写操作 + 用户确认 | `create_order` 只生成待确认动作；确认卡提交后才建单 | `server/agent/agent-购物助手.js` |
| 9.5 多步规划与约束冲突 | “先搜再第一个加购”；“300 以内又要 500 以上”直接指出冲突 | 同上 |
| 9.6 澄清 / 超范围 / 防注入 / 异常 | 歧义反问、超范围拒答、拒绝套密钥、空/超长/非法 JSON | `localbrain-本地规则引擎.js`、`llm-大模型适配器.js` |
| 9.7 流式 / 持久化 / 富消息 / 裁剪 | SSE 事件、会话落盘、60 条上限、会话恢复 | `conversation-会话存储.js`、`agent-购物助手接口.js` |
| 9.8 ≥10 用例、Trace、指标、模型对比 | 30 条用例、100% 通过、Trace、指标报告；模型对比方法已写，需 API Key 实跑 | `tests/eval/`、`docs/AI评测报告.md` |
| 10 README / 本地演示 / 在线 Demo 加分 | README + 19 页 PDF + 演示脚本；在线 Demo 需用自己的服务器部署 | `docs/演示脚本-答辩怎么讲.md`、`deploy/` |

## 三、目录结构

文件名前半段英文说明「这是什么」，后半段中文说明「它干什么」，例如 `cart-购物车服务.js`、`checkout-结算下单.js`。

```
xiaoman-mall/
├─ server/                         后端（只在 Node 里运行）
│  ├─ index-服务入口.js             创建 HTTP 服务，分发 /api 与静态文件
│  ├─ router-迷你路由.js            路由注册、:id 参数、query/body 解析、统一错误
│  ├─ data/                        数据表：商品/分类是种子，其余运行时生成
│  │  ├─ products-商品数据.json     26 件商品
│  │  ├─ categories-商品分类.json   6 个分类
│  │  ├─ carts-购物车数据.json      运行时生成
│  │  ├─ orders-订单数据.json       运行时生成
│  │  ├─ users-用户数据.json        运行时生成
│  │  ├─ sessions-用户会话.json     运行时生成
│  │  ├─ conversations-助手会话.json 运行时生成
│  │  └─ agent-traces.jsonl        运行时追加工具调用 Trace
│  ├─ lib/                         与业务无关的工具
│  │  ├─ response-统一响应格式.js   ok / fail / HttpError / sendJson
│  │  ├─ store-JSON数据存储.js      读写 JSON、内存缓存、按表名找文件
│  │  ├─ static-静态文件服务.js     HTML/CSS/JS/SVG、404、304
│  │  └─ session-会话与Cookie.js    xm_session、HttpOnly、SameSite
│  ├─ services/                    业务规则都在这层
│  │  ├─ catalog-商品查询服务.js    搜索、筛选、排序、分页、推荐
│  │  ├─ cart-购物车服务.js         加购、改数量、删除、清空、算金额
│  │  ├─ orders-订单服务.js         下单、运费、扣库存、支付、取消回滚
│  │  └─ auth-用户认证服务.js       注册、scrypt 哈希、登录、会话
│  ├─ routes/                      HTTP 与 service 之间的薄薄一层
│  │  ├─ products-商品接口.js       5 个
│  │  ├─ cart-购物车接口.js         5 个
│  │  ├─ orders-订单接口.js         5 个
│  │  ├─ auth-认证接口.js           4 个
│  │  └─ agent-购物助手接口.js      5 个
│  └─ agent/                       AI 购物助手
│     ├─ agent-购物助手.js          选模式、调模型/规则、执行工具、写 Trace
│     ├─ tools-工具集.js            8 个工具的定义与执行
│     ├─ localbrain-本地规则引擎.js 无 API Key 也能跑
│     ├─ llm-大模型适配器.js        OpenAI 兼容接口 + function calling
│     └─ conversation-会话存储.js   消息、memory、待确认动作
├─ public/                         前端（浏览器直接加载）
│  ├─ index-首页.html
│  ├─ product-商品详情页.html
│  ├─ orders-我的订单页.html
│  ├─ 404-页面不存在.html
│  ├─ css/                         7 个样式文件：五个基础层 + 登录 + 助手
│  └─ js/                          13 个 ES Module，一个文件一件事
├─ tests/                          46 条自动测试 + 30 条 AI 评测
│  ├─ unit/                        4 个 service 单元测试（37 条）
│  ├─ api/api-接口集成.test.mjs    真实进程 + HTTP + Cookie + SSE（9 条）
│  ├─ eval/                        30 条用例、执行器、最近结果
│  └─ 测试辅助-临时数据目录.mjs    测试用 XM_DATA_DIR，不碰演示数据
├─ deploy/                         上线用：systemd / Nginx / Docker / 环境变量
│  ├─ xiaoman-mall.service         systemd 托管，非 root、崩溃自动拉起
│  ├─ nginx-小满商城.conf          HTTPS、反向代理、SSE 不缓冲
│  ├─ Dockerfile / docker-compose.yml
│  └─ xiaoman-mall.env.example     生产环境变量模板
├─ docs/                           说明书、接口、阅读路线、部署、演示、评测、截图
├─ scripts/gen-covers-生成商品封面.js
├─ 启动商城.bat
├─ package.json
└─ README.md
```

### 文件夹速查

每个文件夹里都有一份 `说明-这个文件夹装什么.md`，写清了“装了什么、和谁配合、怎么读”。

| 文件夹 | 装什么 | 详细 |
| --- | --- | --- |
| `server/` | 入口、路由、数据、工具、服务、接口、AI 助手 | [说明](server/说明-这个文件夹装什么.md) |
| `server/agent/` | AI 助手的编排、8 个工具、本地规则、大模型适配、会话 | [说明](server/agent/说明-这个文件夹装什么.md) |
| `server/data/` | 7 张 JSON 表 + 助手调用日志 | [说明](server/data/说明-这个文件夹装什么.md) |
| `server/lib/` | 统一响应、JSON 存储、静态文件、Cookie 会话 | [说明](server/lib/说明-这个文件夹装什么.md) |
| `server/services/` | 商品、购物车、订单、认证四组业务规则 | [说明](server/services/说明-这个文件夹装什么.md) |
| `server/routes/` | 24 个接口的参数层 | [说明](server/routes/说明-这个文件夹装什么.md) |
| `public/` | 5 个页面、8 个样式、14 个模块、商品封面 | [说明](public/说明-这个文件夹装什么.md) |
| `public/css/` | 基础、布局、组件、页面、补充、登录、助手、目录页 | [说明](public/css/说明-这个文件夹装什么.md) |
| `public/js/` | 请求、状态、登录、组件、五个页面入口 | [说明](public/js/说明-这个文件夹装什么.md) |
| `public/assets/` | 静态资源 | [说明](public/assets/说明-这个文件夹装什么.md) |
| `public/assets/products/` | 26 张商品封面 SVG | [说明](public/assets/products/说明-这个文件夹装什么.md) |
| `scripts/` | 生成商品封面的脚本 | [说明](scripts/说明-这个文件夹装什么.md) |
| `tests/` | 46 条自动测试 + 30 条 AI 评测 | [说明](tests/说明-这个文件夹装什么.md) |
| `tests/unit/` | 4 个 service 单元测试（37 条） | [说明](tests/unit/说明-这个文件夹装什么.md) |
| `tests/api/` | 真实进程的 HTTP 集成测试（9 条） | [说明](tests/api/说明-这个文件夹装什么.md) |
| `tests/eval/` | AI 评测用例、执行器、结果 | [说明](tests/eval/说明-这个文件夹装什么.md) |
| `deploy/` | systemd、Nginx、Docker、环境变量模板 | [说明](deploy/说明-这个文件夹装什么.md) |
| `docs/` | 说明书、接口、阅读路线、部署、演示、评测 | [说明](docs/说明-这个文件夹装什么.md) |
| `docs/screenshots/` | 12 张界面截图 | [说明](docs/screenshots/说明-这个文件夹装什么.md) |

### 按功能找文件

| 想改什么 | 先看哪里 |
| --- | --- |
| 搜索、筛选、排序、分页 | `server/services/catalog-商品查询服务.js` → `public/js/products-全部商品页逻辑.js` |
| 加购、改数量、删除、金额 | `server/services/cart-购物车服务.js` → `public/js/cartdrawer-购物车抽屉.js` |
| 运费、下单、库存、支付、取消 | `server/services/orders-订单服务.js` → `public/js/checkout-结算下单.js` |
| 注册、登录、Cookie、订单归属 | `server/services/auth-用户认证服务.js`、`server/lib/session-会话与Cookie.js` |
| AI 工具、话术、多轮 | `server/agent/` → `public/js/agent-购物助手面板.js` |
| 颜色、间距、卡片长相 | `public/css/base-设计变量与基础样式.css` → `components` → `pages` |

## 四、三条关键链路

### 1. 搜索 / 筛选（前端只传条件，后端负责算）

```
用户点「数码」或输入「耳机」
  → home-首页逻辑.js 更新 state，并同步到地址栏 ?category=数码&keyword=耳机
  → api.products.list(state) 拼出 /api/products?category=...&keyword=...&page=1&pageSize=8
  → catalog-商品查询服务.js：关键词 → 分类 → 价格 → 排序 → 分页
  → 返回 { list, total, totalPages }
  → 首页渲染卡片、结果数量、分页器；没有结果就显示空态
```

每个请求带一个自增的 `requestSeq`：连续快速点击时，只有最后一次请求的结果会落地，避免旧结果覆盖新结果。

### 2. 加入购物车（状态放在服务端）

```
点「加入购物车」
  → cartStore.add(productId, quantity)
  → POST /api/cart/items { cartId, productId, quantity }
  → 服务端找到购物车（没有就新建），校验库存，累加数量
  → 返回整辆车的最新快照 { items, totalQuantity, totalAmount }
  → cartStore 更新 state，通知所有订阅者
  → 顶栏角标、侧拉抽屉、结算弹窗同时更新
```

购物车放在服务端，是为了下单时还能再校验一次库存和价格；前端改不了金额。

### 3. 下单 + 模拟支付

```
点「去结算」→ 填收货人 / 手机号 / 地址 → 提交
  → 前端先做格式校验（手机号 /^1[3-9]\d{9}$/，地址至少 5 个字）
  → POST /api/orders { cartId, receiver, remark }
  → 服务端重新读购物车、校验库存、按数据库单价重算金额、生成订单号
  → 返回 201 和新订单
  → 前端调 POST /api/orders/:id/pay（停 900ms 模拟支付）
  → 订单号写 localStorage，跳 orders-我的订单页.html?id=订单号
  → 结果页 GET /api/orders/:id 渲染状态、明细、金额、收货信息
```

订单号格式：`XM` + 年月日 + 6 位大写十六进制，例如 `XM20261021A1B2C3`。

## 五、接口一览

所有接口统一返回：

```json
{ "code": 0, "message": "ok", "data": {} }
```

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
| GET | `/api/orders` | 当前用户订单列表（未登录 401） |
| GET | `/api/orders/:id` | 订单详情（校验归属） |
| POST | `/api/orders/:id/pay` | 模拟支付 |
| POST | `/api/orders/:id/cancel` | 取消订单并回滚库存 |
| POST | `/api/auth/register` | 注册并自动登录 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出并清 Cookie |
| GET | `/api/auth/me` | 当前用户或 null |
| POST | `/api/agent/chat` | AI 对话，返回 SSE |
| POST | `/api/agent/confirm` | 确认 / 取消下单动作 |
| GET | `/api/agent/conversation/:id` | 恢复会话 |
| GET | `/api/agent/config` | 模式、模型、是否登录 |
| GET | `/api/agent/tools` | 工具清单 |

完整参数、响应示例和错误码表见 [接口文档](docs/接口文档-前后端约定.md)。

## 六、数据、测试与 AI 评测

### 七张 JSON 表

| 文件 | 内容 |
| --- | --- |
| `products-商品数据.json` | 26 件商品：id、名称、品牌、分类、子分类、价格、原价、库存、评分、销量、标签、搜索词、简介、详细介绍、卖点、封面 |
| `categories-商品分类.json` | 6 个分类的 key、名称、emoji、一句描述 |
| `users-用户数据.json` | 用户名、昵称、盐、密码哈希、注册时间 |
| `sessions-用户会话.json` | token 的 SHA-256 摘要、userId、过期时间 |
| `carts-购物车数据.json` | cartId、items、创建/更新时间 |
| `orders-订单数据.json` | 订单号、userId、商品快照、金额、收货信息、状态与时间 |
| `conversations-助手会话.json` | 会话 id、userId、消息、memory、待确认动作 |

`agent-traces.jsonl` 是助手每次调用的 Trace，一行一条，不属于这七张表。

商品和分类是种子数据，不要删；其余是运行时数据，删掉后第一次写入会自动重建。想清空演示数据：

```powershell
Remove-Item server/data/carts-*.json, server/data/orders-*.json, \
  server/data/users-*.json, server/data/sessions-*.json, \
  server/data/conversations-*.json, server/data/agent-traces.jsonl -ErrorAction SilentlyContinue
```

> 清空订单不会自动把库存加回去；要连库存一起恢复，用 Git 恢复 `products-商品数据.json` 的初始版本。

### 46 条自动测试

| 测试文件 | 条数 | 覆盖 |
| --- | --- | --- |
| `catalog-商品查询服务.test.mjs` | 9 | 关键词、分类、价格、排序、分页、参数校验 |
| `cart-购物车服务.test.mjs` | 10 | 加购、累加、库存上限、改数量、删除、清空、金额 |
| `orders-订单服务.test.mjs` | 9 | 重算金额、运费、扣库存、支付、取消回滚 |
| `auth-用户认证服务.test.mjs` | 9 | 注册、重名、登录、错误密码、会话、过期 |
| `api-接口集成.test.mjs` | 9 | 真实 HTTP、Cookie、401/403、AI 确认流程 |
| **合计** | **46** | 约 4 秒跑完 |

单元测试直接调用 service，用临时数据目录；集成测试 `spawn` 启动真实服务，换端口、换数据目录，走完整 HTTP。

### AI 助手评测（30 条）

`node tests/eval/run-评测.mjs` 使用隔离数据启动服务，逐条跑 9.1–9.7 的场景，统计：

- 用例通过率 / 任务完成率；
- 工具选择正确率、参数正确率；
- 回复级 / 断言级幻觉率；
- 拒答与澄清正确率；
- 端到端耗时、每次工具调用 Trace。

当前本地规则引擎基线：**30/30 通过，工具选择 40/40，参数 46/46，幻觉 0/27，拒答澄清 4/4**。测试集和报告在 `tests/eval/`、[AI 评测报告](docs/AI评测报告.md)。

> 9.8 的“模型对比”需要 `AGENT_API_KEY`：同一套用例加 `--mode=llm` 再跑一次，把结果复制成 `评测结果-大模型.json`。没有 Key 时报告只代表本地基线，不冒充大模型效果。

## 七、登录态与 AI 助手

### 登录态

- 密码用 `crypto.scryptSync(password, salt, 64)` 加盐哈希，数据库里没有明文；
- 登录生成 32 字节随机 token，只把 SHA-256 摘要存进 `sessions`，原始 token 放进 `xm_session` Cookie；
- Cookie 是 `HttpOnly; SameSite=Lax`，HTTPS 下自动加 `Secure`，JS 读不到；
- 订单带 `userId`：`GET /api/orders` 只返回自己的；查看 / 支付 / 取消别人的订单返回 403；
- 未登录可浏览、加购、下单，但生成的是游客订单：只能凭订单号查看，不会出现在账号的订单列表里；登录后下的单才跟账号走。

### AI 购物助手

- 入口：三个页面右下角「问问小满」，桌面侧浮面板，手机底部整宽；
- 两种模式：`AGENT_MODE=local`（默认，规则引擎，不联网）和 `AGENT_MODE=llm`（OpenAI 兼容接口 + function calling）；
- 8 个工具：`search_products`、`get_product`、`view_cart`、`add_to_cart`、`update_cart_quantity`、`list_my_orders`、`get_order`、`create_order`；
- 写操作只生成 `act_` 开头的待确认动作；用户填收货信息、点「确认下单」后才真正建单，金额由订单服务重算；
- SSE 事件：`meta / status / notice / delta / products / cart / action / error / done`；
- 安全边界：超范围拒答、歧义先反问、拒绝套系统提示或密钥；价格、库存、订单状态只来自工具结果。

## 八、响应式是怎么做的

- 布局用 flex 和 grid（`minmax(min(100%, 240px), 1fr)`），卡片自动换行；
- 字号、间距用 `clamp()` 和 rem，而不是固定 px；
- 断点：`960px` 详情页改单列、`860px` 导航只留图标、`640px` 卡片单列/订单项换行、`400px` 再收紧间距；
- 390px 手机和 250% 缩放下验证过，没有横向滚动条。

## 九、部署到自己的服务器

仓库已经准备好 `deploy/`：

| 文件 | 作用 |
| --- | --- |
| `xiaoman-mall.service` | systemd：非 root、开机自启、崩溃拉起、日志进 journald、ProtectSystem |
| `nginx-小满商城.conf` | 80 跳 443、证书、gzip、静态缓存、SSE 不缓冲、安全头 |
| `xiaoman-mall.env.example` | 环境变量模板：端口、数据目录、Agent 模式与 Key |
| `Dockerfile` / `docker-compose.yml` | 可选容器方案，数据卷持久化 |

步骤概要：

1. 服务器装 Node.js 18+，把项目放到 `/var/www/xiaoman-mall`；
2. 复制 `deploy/xiaoman-mall.service` 到 `/etc/systemd/system/`，`systemctl enable --now xiaoman-mall`；
3. Nginx 反代 `127.0.0.1:3000`，申请证书；
4. API Key 只放 `/etc/xiaoman-mall.env`，权限 600，不进仓库。

**域名与备案**：境内服务器绑定正式域名，通常要先完成 ICP 备案；境外服务器不需要。完整步骤和排查见 [部署-服务器与域名](docs/部署-服务器与域名.md)。

## 十、出错了怎么查

1. **接口 404**：看 Network 里路径是不是 `/api/...`，方法是不是写错；
2. **400**：看 Response 的 `code`，40011 是价格参数、40021 是数量、40031 是空购物车；
3. **401 / 403**：没登录或登录过期；403 还可能是看别人的订单；
4. **409**：库存或订单状态冲突，`message` 里写了具体原因；
5. **Failed to fetch**：服务没启动、端口不对，或直接双击了 HTML；
6. **页面样式不对**：Ctrl+F5 强刷，确认 CSS 路径大小写；
7. **AI 一直“正在思考”**：看 `/api/agent/chat` 是否流式返回；Nginx 要关 `proxy_buffering`；
8. 终端每条请求都有 `requestId`、方法、路径、状态码、耗时，可和前端时间对照。

## 十一、AI Coding Process

这一节回答考核第十部分：**AI 在项目里具体怎么被使用、怎么被验证**。完整版见 [Prompt Engineering 与 AI Coding Process](docs/Prompt-Engineering与AI协作.md)。

1. **先拆验收点**：把 3.2–3.9、第四部分接口、第五部分数据、第八部分账号、第九部分 9.1–9.8 拆成可勾选清单，完成一项才改 README 的 ✅。
2. **先接口后页面**：数据结构 → service → route → 接口文档 → 页面；页面里不写业务规则。
3. **一次只改一件事**：每次让 AI 只动一个文件或一个行为，改完立刻跑对应测试。
4. **让 AI 找反例**：追问“最可能破坏哪个已有功能”“给我三个会失败的用户输入”“后端 409 时前端显示什么”。
5. **人工验收**：无头 Chrome 截图看排版，Network 看状态码，终端日志对时间；AI 说“完成”不等于页面对。
6. **失败要记录**：Windows 的 `ReplaceFileW EIO` 用重试解决，JSON 的 `EBUSY` 用退避重试解决；不静默吞错。
7. **文档同步**：新增接口就更新接口文档，新增行为就补评测用例，新增命令就更新 README。

验证分工：

| 改动 | 验证方式 |
| --- | --- |
| 页面 / 样式 | CDP 截图、390px 视口、250% 缩放、console 无报错 |
| 接口 / 业务规则 | `npm test`（单元 + 真实 HTTP） |
| Agent 话术 / 多轮 | `node tests/eval/run-评测.mjs` |
| 完整下单链路 | 浏览器手动走一遍，或 `.verify/test-agent-ui.mjs` |

## 十二、还没做的部分

- 真实支付、商品管理后台、图片上传、邮箱验证、多租户；
- 订单并发写入的数据库级事务（当前单进程 + JSON 文件，适合演示，不适合高并发）；
- AI 大模型实跑对比需要 API Key；报告里的 30/30 是本地规则引擎基线；
- 代码还没有推到 GitHub（按当前约定只保留本地仓库）；
- 在线 Demo 还没部署，`deploy/` 已准备好，按第九节操作即可。

---

### 文档索引

| 文档 | 用途 |
| --- | --- |
| [文件说明书（PDF）](docs/小满商城-文件说明书.pdf) | 19 页，逐个文件讲作用与请求流程 |
| [文件说明书（HTML）](docs/说明书-小满商城.html) | 可打印源文件，A4 分页 |
| [接口文档](docs/接口文档-前后端约定.md) | 24 个接口、错误码、排查 |
| [阅读路线](docs/阅读路线-从跑起来到讲清楚.md) | 从当用户到读代码的 11 站（含账号、AI、测试） |
| [代码地图](docs/代码地图-类名与行为索引.md) | 213 个类名 / 88 个 id / 20 个 data-* 分别指向哪里；读代码卡住时按名字查 |
| [演示脚本](docs/演示脚本-答辩怎么讲.md) | 8 分钟演示顺序与追问 |
| [AI 评测报告](docs/AI评测报告.md) | 30 条用例、指标、Trace |
| [Prompt Engineering](docs/Prompt-Engineering与AI协作.md) | 提示词、工具设计、失败复盘 |
| [部署](docs/部署-服务器与域名.md) | Nginx、systemd、HTTPS、备案 |
