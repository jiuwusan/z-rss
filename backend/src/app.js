import Koa from 'koa';
import router from './routes/index.js';
import { createErrorResponse } from './utils/response.util.js';

/**
 * 创建并组装 Koa 应用。
 * @returns {Koa}
 */
export function createApp() {
  const app = new Koa();

  app.use(router.routes());
  app.use(router.allowedMethods());
  app.use(async (ctx) => {
    ctx.status = 404;
    ctx.body = createErrorResponse(404, '接口不存在');
  });

  return app;
}
