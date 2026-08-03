/**
 * 创建可由统一错误中间件识别的 HTTP 错误。
 * @param {number} status HTTP 状态码
 * @param {string} message 对外错误消息
 * @returns {Error & { status: number }}
 */
export function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
