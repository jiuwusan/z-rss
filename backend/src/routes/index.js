import Router from '@koa/router';
import { createRssRepository } from '../repositories/rss.repository.js';
import { createRssSubscriptionService } from '../services/rss-subscription.service.js';
import { createRssService } from '../services/rss.service.js';
import healthRouter from './health.route.js';
import { createRssRouter } from './rss.route.js';

/**
 * 创建应用总路由。
 * @param {{ repository?: object, rssService?: object, subscriptionService?: object }} options 可注入依赖
 * @returns {Router}
 */
export function createRouter(options = {}) {
  const router = new Router();
  const repository = options.repository ?? createRssRepository();
  const rssService = options.rssService ?? createRssService({ repository });
  const subscriptionService = options.subscriptionService
    ?? createRssSubscriptionService({ repository });
  const rssRouter = createRssRouter({ rssService, subscriptionService });

  router.use(healthRouter.routes(), healthRouter.allowedMethods());
  router.use(rssRouter.routes(), rssRouter.allowedMethods());
  return router;
}
