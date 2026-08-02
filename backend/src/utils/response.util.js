/**
 * 构造统一成功响应。
 * @param {unknown} data 响应数据
 * @param {string} message 响应消息
 * @returns {{ code: 0, message: string, data: unknown }}
 */
export function createSuccessResponse(data, message = 'success') {
  return {
    code: 0,
    message,
    data,
  };
}

/**
 * 构造统一错误响应。
 * @param {number} code 错误码
 * @param {string} message 错误消息
 * @returns {{ code: number, message: string, data: null }}
 */
export function createErrorResponse(code, message) {
  return {
    code,
    message,
    data: null,
  };
}
