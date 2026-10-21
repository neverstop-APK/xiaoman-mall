/**
 * 【文件作用】购物车状态管理：全站唯一的购物车数据源
 * --------------------------------------------------------------------------
 * 一个很小的"发布订阅"模型，和 Redux / Pinia 的思路一样，只是少了库：
 *
 *   页面组件  --subscribe-->  store
 *   页面组件  --调用 action--> store --调接口--> 后端
 *                                |
 *                                +-- emit() --> 通知所有订阅者重绘
 *
 * 关键点：
 *   · 数据只有一份（this.state），不存在"这里显示 3 件、那里显示 2 件"的问题；
 *   · 每个 action 都是 async，页面 await 它就能知道成功还是失败；
 *   · cartId 存在 localStorage，刷新页面购物车还在。
 *
 * 【对应知识点】localStorage、闭包、Promise / async、对象与数组方法（find / reduce）
 * 【对应考核点】3.7 合理状态管理
 */
import { api } from './api-请求封装.js';

const CART_ID_KEY = 'xm_cart_id';

export class CartStore {
  constructor() {
    this.state = {
      id: null,
      items: [],
      totalQuantity: 0,
      totalAmount: 0,
      ready: false, // 第一次从服务器拉取是否完成
      busy: [] // 正在请求中的商品 id，用来禁用按钮、防止连点
    };
    this.listeners = new Set(); // Set 自动去重，同一个函数不会被订阅两次
  }

  /** 订阅：返回取消订阅的函数，页面卸载时可以调用 */
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state); // 订阅时立刻推一次当前状态，避免首屏空白
    return () => this.listeners.delete(listener);
  }

  /** 通知所有订阅者（这里用展开运算符生成新对象，是 React 里"不可变数据"的习惯） */
  emit(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  getCartId() {
    return localStorage.getItem(CART_ID_KEY) || '';
  }

  setCartId(id) {
    if (id) localStorage.setItem(CART_ID_KEY, id);
  }

  isBusy(productId) {
    return this.state.busy.includes(productId);
  }

  /** 统一的"请求中"标记：开始加进去，结束拿掉 */
  async withBusy(productId, task) {
    this.emit({ busy: [...this.state.busy, productId] });
    try {
      return await task();
    } finally {
      this.emit({ busy: this.state.busy.filter((id) => id !== productId) });
    }
  }

  /** 把接口返回的购物车写进 state，并记住 cartId */
  applyCart(cart) {
    this.setCartId(cart.id);
    this.emit({
      id: cart.id,
      items: cart.items,
      totalQuantity: cart.totalQuantity,
      totalAmount: cart.totalAmount
    });
    return cart;
  }

  /** 页面加载时调用：拿回服务端保存的购物车 */
  async init() {
    try {
      const cart = await api.cart.get(this.getCartId());
      this.applyCart(cart);
    } catch (error) {
      // 购物车加载失败不该让整个首页白屏，记一笔日志，继续用空购物车
      console.warn('购物车初始化失败：', error.message);
    } finally {
      this.emit({ ready: true });
    }
  }

  add(productId, quantity = 1) {
    return this.withBusy(productId, async () => {
      const cart = await api.cart.add({ cartId: this.getCartId(), productId, quantity });
      return this.applyCart(cart);
    });
  }

  updateQuantity(productId, quantity) {
    if (quantity < 1) return this.remove(productId);
    return this.withBusy(productId, async () => {
      const cart = await api.cart.updateQuantity({ cartId: this.getCartId(), productId, quantity });
      return this.applyCart(cart);
    });
  }

  remove(productId) {
    return this.withBusy(productId, async () => {
      const cart = await api.cart.remove({ cartId: this.getCartId(), productId });
      return this.applyCart(cart);
    });
  }

  clear() {
    return this.withBusy('__all__', async () => {
      const cart = await api.cart.clear(this.getCartId());
      return this.applyCart(cart);
    });
  }

  /** 下单成功后本地也要清空，否则抽屉里还显示旧商品 */
  resetLocal() {
    this.emit({ items: [], totalQuantity: 0, totalAmount: 0 });
  }

  /** 商品详情页要用：某个商品在购物车里已经有几件 */
  quantityOf(productId) {
    const hit = this.state.items.find((item) => item.productId === productId);
    return hit ? hit.quantity : 0;
  }
}

// 单例：整个页面共享同一个实例（ES 模块本身就有缓存，天然单例）
export const cartStore = new CartStore();
