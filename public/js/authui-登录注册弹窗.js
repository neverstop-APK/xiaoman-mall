/**
 * 【文件作用】登录 / 注册界面：顶栏按钮、弹窗、账号菜单
 * ------------------------------------------------------------
 * 为什么用 JS 注入弹窗，而不是每个 HTML 都写一遍？
 * 因为登录弹窗在首页、详情页、订单页都要用，写三份以后改一次要改三处。
 * 这里在初始化时把弹窗和菜单插入 body，三个页面只需要放一个 #accountBtn。
 *
 * 交互：
 *   · 未登录：点顶栏"登录"打开弹窗，可在登录 / 注册之间切换；
 *   · 已登录：点顶栏昵称弹出菜单，可去"我的订单"或退出；
 *   · 登录 / 退出后派发 auth:change 事件，订单页据此重新加载。
 *
 * 【对应知识点】DOM 创建与插入、事件委托、表单校验、classList
 * 【对应考核点】八、注册 / 登录 / 退出、登录状态
 */
import { authStore } from './auth-登录状态.js';
import { $, toast, openModal, closeModal, bindDismiss, escapeHtml } from './ui-通用界面工具.js';

let mode = 'login'; // login | register

const MODAL_HTML = [
  '<div class="modal-wrap" id="authModal" role="dialog" aria-modal="true" aria-labelledby="authTitle">',
  '  <div class="modal auth-modal">',
  '    <div class="modal-head">',
  '      <h2 class="h3" id="authTitle">登录</h2>',
  '      <button class="icon-btn" type="button" id="authCloseBtn" aria-label="关闭">',
  '        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  '      </button>',
  '    </div>',
  '    <div class="auth-tabs" role="tablist">',
  '      <button class="auth-tab is-active" type="button" data-mode="login" role="tab">登录</button>',
  '      <button class="auth-tab" type="button" data-mode="register" role="tab">注册</button>',
  '    </div>',
  '    <form id="authForm" novalidate>',
  '      <div class="modal-body">',
  '        <label class="field">',
  '          <span class="field-label">用户名</span>',
  '          <input class="input" id="authUsername" autocomplete="username" maxlength="20" placeholder="3–20 位，中英文 / 数字 / 下划线">',
  '        </label>',
  '        <label class="field" data-register-only hidden>',
  '          <span class="field-label">昵称（选填）</span>',
  '          <input class="input" id="authNickname" maxlength="12" placeholder="不填就用用户名">',
  '        </label>',
  '        <label class="field">',
  '          <span class="field-label">密码</span>',
  '          <input class="input" id="authPassword" type="password" autocomplete="current-password" maxlength="32" placeholder="6–32 位">',
  '        </label>',
  '        <label class="field" data-register-only hidden>',
  '          <span class="field-label">确认密码</span>',
  '          <input class="input" id="authConfirm" type="password" autocomplete="new-password" maxlength="32" placeholder="再输入一次">',
  '        </label>',
  '        <p class="auth-error" id="authError" role="alert" hidden></p>',
  '        <p class="text-xs text-muted">注册后会自动登录。密码用 scrypt 加盐哈希保存，登录态通过 HttpOnly Cookie 维持。</p>',
  '      </div>',
  '      <div class="modal-foot">',
  '        <button class="btn btn-ghost" type="button" data-close-auth>取消</button>',
  '        <button class="btn btn-primary" type="submit" id="authSubmit">登录</button>',
  '      </div>',
  '    </form>',
  '  </div>',
  '</div>',
  '<div class="account-menu" id="accountMenu" hidden role="menu">',
  '  <div class="account-menu-head">',
  '    <strong id="accountName">—</strong>',
  '    <span class="text-xs text-muted" id="accountSince"></span>',
  '  </div>',
  '  <a class="account-menu-item" href="./orders-我的订单页.html" role="menuitem">我的订单</a>',
  '  <button class="account-menu-item" type="button" id="accountLogout" role="menuitem">退出登录</button>',
  '</div>'
].join('\n');

function inject() {
  if ($('#authModal')) return;
  const holder = document.createElement('div');
  holder.innerHTML = MODAL_HTML;
  document.body.appendChild(holder);
}

function setMode(next) {
  mode = next === 'register' ? 'register' : 'login';
  $('#authTitle').textContent = mode === 'login' ? '登录' : '注册';
  $('#authSubmit').textContent = mode === 'login' ? '登录' : '注册并登录';
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.mode === mode);
  });
  document.querySelectorAll('[data-register-only]').forEach((field) => {
    field.hidden = mode !== 'register';
  });
  $('#authError').hidden = true;
}

function showError(message) {
  const box = $('#authError');
  box.textContent = message;
  box.hidden = false;
}

export function openAuth(nextMode) {
  setMode(nextMode || 'login');
  $('#authUsername').value = '';
  $('#authPassword').value = '';
  $('#authConfirm').value = '';
  $('#authNickname').value = '';
  openModal($('#authModal'));
  setTimeout(() => $('#authUsername').focus(), 80);
}

function closeAuth() {
  closeModal($('#authModal'));
}

async function submit(event) {
  event.preventDefault();

  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const confirm = $('#authConfirm').value;
  const nickname = $('#authNickname').value.trim();
  const button = $('#authSubmit');

  if (username.length < 3) return showError('用户名至少 3 位');
  if (password.length < 6) return showError('密码至少 6 位');
  if (mode === 'register' && password !== confirm) return showError('两次输入的密码不一样');

  const original = button.textContent;
  button.disabled = true;
  button.textContent = mode === 'login' ? '登录中…' : '注册中…';

  try {
    if (mode === 'login') {
      await authStore.login(username, password);
      toast('欢迎回来，' + authStore.state.user.nickname, 'success');
    } else {
      await authStore.register(username, password, nickname);
      toast('注册成功，已经帮你登录了', 'success');
    }
    closeAuth();
    window.dispatchEvent(new CustomEvent('auth:change', { detail: { user: authStore.state.user } }));
  } catch (error) {
    showError(error.message || '操作失败，请重试');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderHeader(state) {
  const label = $('#accountLabel');
  const button = $('#accountBtn');
  if (!label || !button) return;
  label.textContent = state.user ? state.user.nickname : '登录';
  button.setAttribute('aria-label', state.user ? '账号：' + state.user.nickname : '登录或注册');
  button.classList.toggle('is-logged-in', Boolean(state.user));

  const name = $('#accountName');
  const since = $('#accountSince');
  if (name) name.textContent = state.user ? state.user.nickname : '—';
  if (since && state.user) {
    since.textContent = '注册于 ' + String(state.user.createdAt || '').slice(0, 10);
  }
}

function toggleMenu() {
  const menu = $('#accountMenu');
  const button = $('#accountBtn');
  if (!menu || !button) return;

  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }

  const rect = button.getBoundingClientRect();
  menu.style.top = rect.bottom + 8 + 'px';
  menu.style.right = Math.max(12, window.innerWidth - rect.right) + 'px';
  menu.hidden = false;
}

export function initAuthUI() {
  inject();
  const modal = $('#authModal');
  const menu = $('#accountMenu');
  const button = $('#accountBtn');
  if (!modal || !button) return;

  bindDismiss({ wrap: modal, onClose: closeAuth });
  $('#authCloseBtn').addEventListener('click', closeAuth);
  modal.querySelectorAll('[data-close-auth]').forEach((btn) => btn.addEventListener('click', closeAuth));
  modal.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });
  $('#authForm').addEventListener('submit', submit);

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (authStore.state.user) toggleMenu();
    else openAuth('login');
  });

  $('#accountLogout').addEventListener('click', async () => {
    await authStore.logout();
    menu.hidden = true;
    toast('已经退出登录', 'success');
    window.dispatchEvent(new CustomEvent('auth:change', { detail: { user: null } }));
  });

  document.addEventListener('click', (event) => {
    if (menu.hidden) return;
    if (!menu.contains(event.target) && !button.contains(event.target)) menu.hidden = true;
  });

  authStore.subscribe((state) => {
    renderHeader(state);
    if (!state.user) menu.hidden = true;
  });

  // 首次进入时把状态拿回来（未登录也返回 null）
  authStore.init();
}
