import Koa from 'koa';
import router from './routes/index.js';

/**
 * 创建并组装 Koa 应用。
 * @returns {Koa}
 */
export function createApp() {
  const app = new Koa();

  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
