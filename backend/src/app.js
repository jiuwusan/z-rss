import { bodyParser } from '@koa/bodyparser';
import Koa from 'koa';
import serve from 'koa-static';
import { fileURLToPath } from 'node:url';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { createRouter } from './routes/index.js';
import { createErrorResponse } from './utils/response.util.js';

const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * 创建并组装 Koa 应用。
 * @param {{ repository?: object, rssService?: object, subscriptionService?: object }} options 应用依赖
 * @returns {Koa}
 */
export function createApp(options = {}) {
  const app = new Koa();
  const router = createRouter(options);

  app.use(errorMiddleware);
  app.use(bodyParser());
  app.use(serve(PUBLIC_DIRECTORY, { index: 'index.html' }));
  app.use(router.routes());
  app.use(router.allowedMethods());
  app.use(async (ctx) => {
    ctx.status = 404;
    ctx.body = createErrorResponse(404, '接口不存在');
  });

  return app;
}
