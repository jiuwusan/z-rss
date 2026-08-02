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
