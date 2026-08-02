import { createErrorResponse } from '../utils/response.util.js';

/**
 * 捕获下游异常并转换为统一错误响应。
 * @param {import('koa').Context} ctx Koa 请求上下文
 * @param {import('koa').Next} next 下游中间件
 */
export async function errorMiddleware(ctx, next) {
  try {
    await next();
  } catch (error) {
    const isHttpStatus =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 600;
    const status = isHttpStatus ? error.status : 500;
    const message =
      status === 500 ? '服务器内部错误' : error.message || '请求失败';

    ctx.status = status;
    ctx.body = createErrorResponse(status, message);

    if (process.env.NODE_ENV === 'development') {
      console.error(error);
    }
  }
}
