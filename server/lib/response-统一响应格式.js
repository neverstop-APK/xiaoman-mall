/**
 * 【文件作用】统一响应格式
 * ------------------------------------------------------------
 * 这个项目里所有接口都返回同一种"信封"：
 *   成功： { code: 0,     message: 'ok',    data: ... }
 *   失败： { code: 40001, message: '数量必须是大于 0 的整数', data: null }
 *
 * 为什么要有统一格式？
 * 前端只要判断 code 是不是 0，就能处理所有接口，
 * 不用每个接口都猜"这次返回的到底是数组还是对象"。
 *
 * 【对应知识点】Node.js 模块化（命名导出 / 模块缓存）
 * 【对应考核点】4.1 后端基础功能 —— 错误处理
 */

// 自定义错误类型：业务代码里 throw 它，router 会统一转成 JSON
class HttpError extends Error {
  /**
   * @param {number} status HTTP 状态码，比如 404 / 400 / 409
   * @param {number} code   业务错误码，比如 40401
   * @param {string} message 给用户看的中文提示
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/** 成功响应 */
function ok(res, data = null, status = 200) {
  sendJson(res, status, { code: 0, message: 'ok', data });
}

/** 失败响应 */
function fail(res, status, code, message) {
  sendJson(res, status, { code, message, data: null });
}

module.exports = { HttpError, ok, fail, sendJson };
