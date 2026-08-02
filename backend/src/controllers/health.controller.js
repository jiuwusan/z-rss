import { getHealthStatus } from '../services/health.service.js';
import { createSuccessResponse } from '../utils/response.util.js';

/**
 * 返回服务健康状态。
 * @param {import('koa').Context} ctx Koa 请求上下文
 */
export async function getHealth(ctx) {
  ctx.status = 200;
  ctx.body = createSuccessResponse(getHealthStatus());
}
