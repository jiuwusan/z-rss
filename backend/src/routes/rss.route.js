import Router from '@koa/router';
import { createRssSubscriptionController } from '../controllers/rss-subscription.controller.js';
import { createRssController } from '../controllers/rss.controller.js';

/**
 * 创建 RSS 业务路由。
 * @param {{ rssService: object, subscriptionService: object }} dependencies 路由依赖
 * @returns {Router}
 */
export function createRssRouter({ rssService, subscriptionService }) {
  const router = new Router();
  const controller = createRssController({ rssService });
  const subscriptionController = createRssSubscriptionController({
    subscriptionService,
  });

  router.get('/rss/platforms', controller.listPlatforms);
  router.post('/rss/platforms', controller.createPlatform);
  router.put('/rss/platforms/:platform', controller.updatePlatform);
  router.delete('/rss/platforms/:platform', controller.deletePlatform);
  router.post('/rss/cache/refresh', controller.refreshCache);
  router.get('/rss/items', controller.listItems);
  router.get('/rss/rules', subscriptionController.listRules);
  router.post('/rss/rules', subscriptionController.createRule);
  router.put('/rss/rules/:id', subscriptionController.updateRule);
  router.delete('/rss/rules/:id', subscriptionController.deleteRule);
  router.get(
    '/rss/subscriptions/matched',
    subscriptionController.getMatchedSubscription,
  );
  router.get(
    '/rss/subscriptions/unmatched',
    subscriptionController.getUnmatchedSubscription,
  );
  return router;
}
