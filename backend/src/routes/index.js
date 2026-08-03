import Router from '@koa/router';
import { createRssService } from '../services/rss.service.js';
import healthRouter from './health.route.js';
import { createRssRouter } from './rss.route.js';

/**
 * 创建应用总路由。
 * @param {{ rssService?: object }} options 可注入依赖
 * @returns {Router}
 */
export function createRouter({ rssService = createRssService() } = {}) {
  const router = new Router();
  const rssRouter = createRssRouter({ rssService });

  router.use(healthRouter.routes(), healthRouter.allowedMethods());
  router.use(rssRouter.routes(), rssRouter.allowedMethods());
  return router;
}
