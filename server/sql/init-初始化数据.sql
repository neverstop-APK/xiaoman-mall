-- =============================================================================
-- 小满商城 · 初始 SQL（SQLite 3）
-- =============================================================================
-- 这份文件做什么：
--   建表 + 写入 6 个分类、26 件商品。
--   商品/分类与 server/data/*.json 一一对应，由 scripts/gen-sql-生成初始化SQL.js 生成。
--
-- 重要说明：
--   当前 Node 后端为了“零依赖、克隆即跑”，运行时读写的是 JSON 文件；
--   这份 SQL 是可执行的等价初始库，供课程提交、评审、以后迁移数据库使用。
--   换成 SQLite/MySQL 时，service 层的业务规则不用改，只替换 store 的读写实现。
--
-- 本地试跑：
--   sqlite3 /tmp/xiaoman-mall.db < server/sql/init-初始化数据.sql
--   sqlite3 /tmp/xiaoman-mall.db "select count(*) from products;"
--
-- 注：这份文件按 SQLite 3 语法生成，可直接执行；
--     若要导入 MySQL，TEXT 主键需改成 VARCHAR(32)，order_items.id 改成 INT AUTO_INCREMENT，
--     其余字段类型按 MySQL 习惯对应调整。
-- =============================================================================

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS carts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;

CREATE TABLE categories (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  brand          TEXT NOT NULL DEFAULT '',
  category_key   TEXT NOT NULL,
  sub_category   TEXT NOT NULL DEFAULT '',
  price          REAL NOT NULL CHECK (price >= 0),
  original_price REAL,
  stock          INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  rating         REAL NOT NULL DEFAULT 0,
  sales          INTEGER NOT NULL DEFAULT 0,
  emoji          TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  features_json  TEXT NOT NULL DEFAULT '[]',
  tags_json      TEXT NOT NULL DEFAULT '[]',
  keywords_json  TEXT NOT NULL DEFAULT '[]',
  cover          TEXT NOT NULL DEFAULT '',
  created_at     TEXT,
  FOREIGN KEY (category_key) REFERENCES categories(key)
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  nickname      TEXT NOT NULL,
  salt          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE carts (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cart_items (
  cart_id    TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  PRIMARY KEY (cart_id, product_id),
  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  goods_amount     REAL NOT NULL,
  shipping_fee     REAL NOT NULL DEFAULT 0,
  total_amount     REAL NOT NULL,
  total_quantity   INTEGER NOT NULL,
  payment_method   TEXT NOT NULL DEFAULT 'mock',
  receiver_name    TEXT NOT NULL DEFAULT '',
  receiver_phone   TEXT NOT NULL DEFAULT '',
  receiver_address TEXT NOT NULL DEFAULT '',
  remark           TEXT NOT NULL DEFAULT '',
  cart_id          TEXT,
  created_at       TEXT NOT NULL,
  paid_at          TEXT,
  cancelled_at     TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '',
  cover      TEXT NOT NULL DEFAULT '',
  price      REAL NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity >= 1),
  subtotal   REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_products_category ON products(category_key);
CREATE INDEX idx_products_sales ON products(sales DESC);
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);

-- 6 个分类
INSERT INTO categories (key, label, emoji, description, sort_order) VALUES ('数码', '数码', '🎧', '耳机 · 键盘 · 随身好物', 1);
INSERT INTO categories (key, label, emoji, description, sort_order) VALUES ('家居', '家居', '🕯️', '让房间慢下来', 2);
INSERT INTO categories (key, label, emoji, description, sort_order) VALUES ('文具', '文具', '📓', '写字也是一件正经事', 3);
INSERT INTO categories (key, label, emoji, description, sort_order) VALUES ('户外', '户外', '🏕️', '出门就是远方', 4);
INSERT INTO categories (key, label, emoji, description, sort_order) VALUES ('服饰', '服饰', '👕', '简单的衣服最好穿', 5);
INSERT INTO categories (key, label, emoji, description, sort_order) VALUES ('配件', '配件', '🧩', '小而重要的小东西', 6);

-- 下面两张表是种子数据；users / sessions / carts / orders / order_items 为空，
-- 由程序在注册、加购、下单时写入，所以这里不插示例账号或订单。

-- 26 件商品
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p01', '听风 Air One 真无线运动耳机', '听风', '数码', '耳机', 299, 359, 35, 4.8, 1293, '🎧', '跑步不掉的真无线耳机', '耳挂式设计加三点支撑，跑步、跳绳都不会掉。IPX5 防水，出汗和雨天都能正常使用。', '["单耳仅 5.2g，久戴不胀耳","双麦克风通话降噪","单次续航 8 小时，配合充电盒 32 小时"]', '["运动","蓝牙5.3","IPX5防水"]', '["耳机","蓝牙耳机","运动耳机","跑步","无线耳机"]', '/assets/products/p01-%E5%90%AC%E9%A3%8EAirOne%E7%9C%9F%E6%97%A0%E7%BA%BF%E8%BF%90%E5%8A%A8%E8%80%B3%E6%9C%BA.svg', '2026-08-02');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p02', '听风 Studio 头戴降噪耳机', '听风', '数码', '耳机', 699, 899, 16, 4.7, 644, '🎧', '地铁里也能安静听歌', '混合式主动降噪，最高降低 38dB 环境噪声。支持有线模式，没电了插线继续听。', '["-38dB 混合主动降噪","40 小时超长续航","蛋白皮耳罩，可折叠收纳"]', '["主动降噪","40h续航","通勤"]', '["耳机","头戴耳机","降噪耳机","通勤"]', '/assets/products/p02-%E5%90%AC%E9%A3%8EStudio%E5%A4%B4%E6%88%B4%E9%99%8D%E5%99%AA%E8%80%B3%E6%9C%BA.svg', '2026-07-18');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p03', '木野 Lute 有线 HiFi 耳机', '木野', '数码', '耳机', 359, NULL, 25, 4.6, 318, '🎵', '入门 HiFi 的稳妥选择', '10mm 动圈单元，三频均衡，人声位置靠前。MMCX 可换线接口，坏了只换线就行。', '["10mm 复合振膜动圈","MMCX 可换线设计","附送 3 副不同尺寸耳塞"]', '["HiFi","可换线","3.5mm"]', '["耳机","有线耳机","HiFi","监听"]', '/assets/products/p03-%E6%9C%A8%E9%87%8ELute%E6%9C%89%E7%BA%BFHiFi%E8%80%B3%E6%9C%BA.svg', '2026-06-30');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p04', '青鸟 Peacock Air 主动降噪耳机', '青鸟', '数码', '耳机', 499, NULL, 30, 4.5, 507, '🕊️', '500 元档的降噪体验', '轻量半入耳结构，长时间佩戴没有压迫感。降噪深度 28dB，办公室和地铁够用。', '["28dB 主动降噪","半入耳轻量佩戴","单次 6 小时续航"]', '["主动降噪","通勤","蓝牙5.2"]', '["耳机","降噪耳机","无线耳机","通勤"]', '/assets/products/p04-%E9%9D%92%E9%B8%9FPeacockAir%E4%B8%BB%E5%8A%A8%E9%99%8D%E5%99%AA%E8%80%B3%E6%9C%BA.svg', '2026-08-11');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p05', '听风 K87 机械键盘', '听风', '数码', '键盘', 449, 529, 20, 4.9, 933, '⌨️', '办公与游戏的甜点位', '87 键紧凑布局，茶轴段落感清晰但不吵。支持热插拔，想换轴体不用焊接。', '["87 键紧凑布局，节省桌面空间","茶轴，段落感清晰","全键热插拔，附赠拔轴器"]', '["87键","茶轴","热插拔"]', '["键盘","机械键盘","外接键盘","办公"]', '/assets/products/p05-%E5%90%AC%E9%A3%8EK87%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98.svg', '2026-07-25');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p06', '木野 K68 机械键盘', '木野', '数码', '键盘', 399, NULL, 35, 4.6, 771, '⌨️', '小尺寸、好携带', '68 键极简布局，红轴直上直下，敲击轻快。双模连接，笔记本和平板都能用。', '["68 键极简布局","红轴，轻触发压力","蓝牙 / 有线双模"]', '["68键","红轴","便携"]', '["键盘","机械键盘","便携","程序员"]', '/assets/products/p06-%E6%9C%A8%E9%87%8EK68%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98.svg', '2026-06-12');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p07', '青鸟 K98 机械键盘', '青鸟', '数码', '键盘', 459, NULL, 12, 4.4, 402, '⌨️', '带数字键区的静音款', '98 键保留了数字键区，会计和做表格的人更顺手。静音红轴，合租宿舍也友好。', '["98 键，保留数字区","静音红轴，敲击声更小","蓝牙 / 2.4G / 有线三模"]', '["98键","静音红轴","三模"]', '["键盘","机械键盘","静音","数字键盘"]', '/assets/products/p07-%E9%9D%92%E9%B8%9FK98%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98.svg', '2026-08-20');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p08', '青鸟 便携蓝牙音箱', '青鸟', '数码', '音箱', 269, NULL, 28, 4.3, 356, '🔊', '露营时的小声场', 'IPX7 级防水，掉进水里捞起来还能用。10 小时续航，一个周末的电量够了。', '["IPX7 防水，可水洗","10 小时续航","支持两台音箱串联立体声"]', '["IPX7防水","户外","10h续航"]', '["音箱","蓝牙音箱","户外","音响"]', '/assets/products/p08-%E9%9D%92%E9%B8%9F%E4%BE%BF%E6%90%BA%E8%93%9D%E7%89%99%E9%9F%B3%E7%AE%B1.svg', '2026-07-05');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p09', '听风 65W 氮化镓充电器', '听风', '数码', '充电', 129, NULL, 60, 4.7, 1502, '🔌', '一个头搞定电脑和手机', '氮化镓方案，体积只有传统 65W 充电器的一半。C 口 + C 口 + A 口，出差只带一个。', '["65W 大功率，可给轻薄本充电","氮化镓，体积更小","三口同时输出"]', '["65W","氮化镓","三口"]', '["充电器","充电头","氮化镓","快充"]', '/assets/products/p09-%E5%90%AC%E9%A3%8E65W%E6%B0%AE%E5%8C%96%E9%95%93%E5%85%85%E7%94%B5%E5%99%A8.svg', '2026-05-28');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p10', '木野 智能手环 4', '木野', '数码', '穿戴', 229, NULL, 33, 4.2, 888, '⌚', '记步、看心率、管睡眠', '50 米防水，游泳也能戴。14 天续航，不用每天充电。', '["50m 防水","14 天续航","血氧与睡眠监测"]', '["心率","14天续航","50m防水"]', '["手环","智能手环","运动","心率"]', '/assets/products/p10-%E6%9C%A8%E9%87%8E%E6%99%BA%E8%83%BD%E6%89%8B%E7%8E%AF4.svg', '2026-08-08');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p11', '砚白 手作陶瓷马克杯', '砚白', '家居', '杯具', 69, NULL, 55, 4.9, 2103, '☕', '每只纹理都不太一样', '手工拉坯，釉色自然流动，所以每一只的纹理都略有差别。可微波、可洗碗机。', '["380ml 容量","可微波炉加热","手工上釉，纹理独一无二"]', '["手工","可微波","380ml"]', '["杯子","马克杯","陶瓷","咖啡杯"]', '/assets/products/p11-%E7%A0%9A%E7%99%BD%E6%89%8B%E4%BD%9C%E9%99%B6%E7%93%B7%E9%A9%AC%E5%85%8B%E6%9D%AF.svg', '2026-04-16');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p12', '砚白 雪松香薰蜡烛', '砚白', '家居', '香薰', 89, NULL, 0, 4.6, 412, '🕯️', '下雨天点一支', '大豆蜡基底，燃烧时没有黑烟。雪松与佛手柑，前调清爽，后调是木头的味道。', '["天然大豆蜡","约 35 小时燃烧时间","可作桌面装饰"]', '["大豆蜡","35h燃烧","木质香"]', '["香薰","蜡烛","香氛","礼物"]', '/assets/products/p12-%E7%A0%9A%E7%99%BD%E9%9B%AA%E6%9D%BE%E9%A6%99%E8%96%B0%E8%9C%A1%E7%83%9B.svg', '2026-06-02');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p13', '木野 原木氛围灯', '木野', '家居', '灯具', 159, NULL, 21, 4.5, 267, '💡', '睡前那点暖光', '实木底座搭配磨砂灯罩，光线柔和不刺眼。三档亮度，用 USB 供电，插充电宝也能亮。', '["三档亮度可调","无频闪，护眼","USB 供电，可接充电宝"]', '["无频闪","三档亮度","USB供电"]', '["台灯","氛围灯","小夜灯","灯"]', '/assets/products/p13-%E6%9C%A8%E9%87%8E%E5%8E%9F%E6%9C%A8%E6%B0%9B%E5%9B%B4%E7%81%AF.svg', '2026-07-11');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p14', '砚白 亚麻抱枕', '砚白', '家居', '布艺', 99, NULL, 40, 4.4, 533, '🛋️', '沙发上的那块低饱和', '水洗亚麻外套，带一点自然的褶皱感。隐藏拉链，外套可以拆下来洗。', '["水洗亚麻面料","外套可拆洗","45 × 45cm"]', '["亚麻","可拆洗","45cm"]', '["抱枕","靠垫","沙发","家居"]', '/assets/products/p14-%E7%A0%9A%E7%99%BD%E4%BA%9A%E9%BA%BB%E6%8A%B1%E6%9E%95.svg', '2026-05-09');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p15', '砚白 A5 手账本', '砚白', '文具', '本册', 39, NULL, 88, 4.7, 1764, '📓', '能完全摊平的笔记本', '锁线装订，可以 180° 摊平。100g 米白纸，钢笔写不洇墨。', '["可 180° 平摊","100g 米白纸，适配钢笔","192 页，附书签带"]', '["100g纸","平摊","192页"]', '["本子","笔记本","手账","文具"]', '/assets/products/p15-%E7%A0%9A%E7%99%BDA5%E6%89%8B%E8%B4%A6%E6%9C%AC.svg', '2026-03-22');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p16', '砚白 黄铜签字笔', '砚白', '文具', '笔具', 129, NULL, 3, 4.8, 288, '🖊️', '用久了会有包浆', '实心黄铜笔身，重量压手，写字稳。用得越久氧化得越好看，可以在笔杆上刻字。', '["实心黄铜笔身","标准 G2 笔芯，可自行更换","支持免费刻字"]', '["黄铜","可换芯","可刻字"]', '["笔","签字笔","钢笔","礼物"]', '/assets/products/p16-%E7%A0%9A%E7%99%BD%E9%BB%84%E9%93%9C%E7%AD%BE%E5%AD%97%E7%AC%94.svg', '2026-04-02');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p17', '木野 羊毛毡桌垫', '木野', '文具', '桌面', 89, NULL, 26, 4.3, 431, '🧶', '键盘底下那一层安静', '羊毛毡材质，吸音而且手感温润。底部硅胶点，不打滑。', '["80 × 40cm 大尺寸","羊毛毡，吸音降噪","底部硅胶防滑点"]', '["羊毛毡","80×40cm","防滑"]', '["桌垫","鼠标垫","桌面","垫子"]', '/assets/products/p17-%E6%9C%A8%E9%87%8E%E7%BE%8A%E6%AF%9B%E6%AF%A1%E6%A1%8C%E5%9E%AB.svg', '2026-06-19');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p18', '野径 316 保温杯', '野径', '户外', '水具', 119, NULL, 47, 4.6, 998, '🥤', '十二小时后还是热的', '316 医用级不锈钢内胆，不容易串味。500ml 容量，一天八杯水的第一杯。', '["316 不锈钢内胆","12 小时保温 / 24 小时保冷","500ml 容量"]', '["316不锈钢","12h保温","500ml"]', '["保温杯","水杯","户外","杯子"]', '/assets/products/p18-%E9%87%8E%E5%BE%84316%E4%BF%9D%E6%B8%A9%E6%9D%AF.svg', '2026-05-15');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p19', '野径 轻量双肩包 22L', '野径', '户外', '背包', 299, NULL, 19, 4.7, 604, '🎒', '通勤和周末都能背', '自重 620g，装满 22L 不塌肩。独立电脑仓，16 寸笔记本放得下。', '["22L 容量，自重 620g","独立 16 寸电脑仓","面料防泼水"]', '["22L","防泼水","可装16寸"]', '["背包","双肩包","通勤","户外"]', '/assets/products/p19-%E9%87%8E%E5%BE%84%E8%BD%BB%E9%87%8F%E5%8F%8C%E8%82%A9%E5%8C%8522L.svg', '2026-07-29');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p20', '野径 防晒遮阳帽', '野径', '户外', '配饰', 99, NULL, 52, 4.2, 741, '🧢', '夏天走路的那片阴影', 'UPF50+ 防晒面料，帽檐可以折叠收纳。速干材质，出汗也不闷。', '["UPF50+ 防晒","帽檐可折叠","速干面料"]', '["UPF50+","可折叠","速干"]', '["帽子","遮阳帽","防晒","户外"]', '/assets/products/p20-%E9%87%8E%E5%BE%84%E9%98%B2%E6%99%92%E9%81%AE%E9%98%B3%E5%B8%BD.svg', '2026-06-25');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p21', '野径 折叠野餐垫', '野径', '户外', '露营', 149, NULL, 23, 4.5, 389, '🧺', '铺开就是一整个下午', '表层亲肤绒布，底层防水。折叠起来只有一个水杯那么大。', '["2 × 1.5m 尺寸","底层防水防潮","折叠后可手提"]', '["2×1.5m","防水底层","可折叠"]', '["野餐垫","露营","垫子","户外"]', '/assets/products/p21-%E9%87%8E%E5%BE%84%E6%8A%98%E5%8F%A0%E9%87%8E%E9%A4%90%E5%9E%AB.svg', '2026-08-05');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p22', '青鸟 纯棉圆领 T 恤', '青鸟', '服饰', '上衣', 89, NULL, 66, 4.4, 1320, '👕', '260g 的厚度，不透', '260g 重磅纯棉，洗几次也不会变薄。落肩版型，宽松但不会垮。', '["260g 重磅纯棉","落肩宽松版型","领口罗纹加固"]', '["纯棉","260g","落肩"]', '["T恤","短袖","衣服","纯棉"]', '/assets/products/p22-%E9%9D%92%E9%B8%9F%E7%BA%AF%E6%A3%89%E5%9C%86%E9%A2%86T%E6%81%A4.svg', '2026-05-02');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p23', '木野 羊毛混纺袜', '木野', '服饰', '袜子', 39, NULL, 90, 4.3, 1877, '🧦', '冬天最实用的礼物', '羊毛混纺，脚感柔软不扎。中筒高度，配球鞋和靴子都合适。', '["羊毛混纺，保暖不捂脚","中筒高度","三双一组"]', '["羊毛混纺","三双装","中筒"]', '["袜子","羊毛袜","保暖","服饰"]', '/assets/products/p23-%E6%9C%A8%E9%87%8E%E7%BE%8A%E6%AF%9B%E6%B7%B7%E7%BA%BA%E8%A2%9C.svg', '2026-04-28');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p24', '听风 记忆棉键盘腕托', '听风', '配件', '腕托', 59, NULL, 44, 4.5, 826, '🖐️', '手腕不那么酸了', '慢回弹记忆棉，承托手腕但不塌陷。外套可以拆下来洗。', '["慢回弹记忆棉","适配 87 键及以下键盘","外套可拆洗"]', '["记忆棉","87键适配","可拆洗"]', '["腕托","手托","键盘配件","人体工学"]', '/assets/products/p24-%E5%90%AC%E9%A3%8E%E8%AE%B0%E5%BF%86%E6%A3%89%E9%94%AE%E7%9B%98%E8%85%95%E6%89%98.svg', '2026-06-08');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p25', '木野 硅胶耳机套', '木野', '配件', '耳机配件', 29, NULL, 120, 4.1, 2050, '🎼', '换一副耳塞，隔音更好', '食品级硅胶，三种尺寸。贴合度提高之后，隔音和低频都会明显变好。', '["食品级硅胶","S / M / L 三副装","适配大多数入耳式耳机"]', '["食品级硅胶","三副装","降噪贴合"]', '["耳塞套","耳机套","硅胶","配件"]', '/assets/products/p25-%E6%9C%A8%E9%87%8E%E7%A1%85%E8%83%B6%E8%80%B3%E6%9C%BA%E5%A5%97.svg', '2026-03-30');
INSERT INTO products (id, name, brand, category_key, sub_category, price, original_price, stock, rating, sales, emoji, summary, description, features_json, tags_json, keywords_json, cover, created_at) VALUES ('p26', '砚白 桌面收纳盒', '砚白', '配件', '收纳', 79, NULL, 31, 4.4, 512, '🗂️', '桌上终于不乱', '三格分区，笔、线材、小物件各有位置。外壳是 ABS 加木纹贴面，可以叠放。', '["三格分区收纳","可上下叠放","ABS + 木纹贴面"]', '["可叠放","三格","ABS+木"]', '["收纳盒","桌面","整理","配件"]', '/assets/products/p26-%E7%A0%9A%E7%99%BD%E6%A1%8C%E9%9D%A2%E6%94%B6%E7%BA%B3%E7%9B%92.svg', '2026-07-02');

COMMIT;

-- 自检：应为 6 和 26
-- SELECT (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM products) AS products;
