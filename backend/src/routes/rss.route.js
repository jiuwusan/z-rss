import Router from '@koa/router';
import { createRssController } from '../controllers/rss.controller.js';

/**
 * 创建 RSS 业务路由。
 * @param {{ rssService: object }} dependencies 路由依赖
 * @returns {Router}
 */
export function createRssRouter({ rssService }) {
  const router = new Router();
  const controller = createRssController({ rssService });

  router.get('/rss/platforms', controller.listPlatforms);
  router.post('/rss/platforms', controller.createPlatform);
  router.put('/rss/platforms/:platform', controller.updatePlatform);
  router.delete('/rss/platforms/:platform', controller.deletePlatform);
  router.post('/rss/cache/refresh', controller.refreshCache);
  router.get('/rss/items', controller.listItems);
  return router;
}
