/**
 * 【文件作用】登录状态：把"当前用户"变成前端可订阅的一份数据
 * ------------------------------------------------------------
 * 和购物车 store 是同一套思路：
 *   · 页面加载时调用 init()，向 /api/auth/me 要当前用户；
 *   · 登录 / 注册 / 退出 之后更新 state 并通知订阅者；
 *   · 顶栏按钮、订单页、结算页都订阅它，不用各自记状态。
 *
 * 登录态本身靠 Cookie 维持（HttpOnly，JS 读不到），
 * 前端只保存"用户信息"用于显示，不保存 token。
 *
 * 【对应知识点】fetch、Promise、发布订阅、模块单例
 * 【对应考核点】八、登录 / 退出 / 登录状态管理
 */
import { api } from './api-请求封装.js';

export class AuthStore {
  constructor() {
    this.state = { user: null, ready: false, busy: false };
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  emit(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  get isLoggedIn() {
    return Boolean(this.state.user);
  }

  /** 页面启动时调用一次 */
  async init() {
    try {
      const data = await api.auth.me();
      this.emit({ user: data.user });
    } catch (error) {
      // 未登录不是错误，但如果服务端异常，也不该让页面白屏
      if (error.status !== 401) console.warn('登录状态读取失败：', error.message);
      this.emit({ user: null });
    } finally {
      this.emit({ ready: true });
    }
  }

  async login(username, password) {
    this.emit({ busy: true });
    try {
      const data = await api.auth.login({ username, password });
      this.emit({ user: data.user });
      return data.user;
    } finally {
      this.emit({ busy: false });
    }
  }

  async register(username, password, nickname) {
    this.emit({ busy: true });
    try {
      const data = await api.auth.register({ username, password, nickname });
      this.emit({ user: data.user });
      return data.user;
    } finally {
      this.emit({ busy: false });
    }
  }

  async logout() {
    try {
      await api.auth.logout();
    } finally {
      this.emit({ user: null });
    }
  }
}

export const authStore = new AuthStore();
