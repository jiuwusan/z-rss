import { createSuccessResponse } from '../utils/response.util.js';

/**
 * 创建 RSS 分流订阅 Controller。
 * @param {{ subscriptionService: object }} dependencies Controller 依赖
 * @returns {object} Koa 路由处理方法
 */
export function createRssSubscriptionController({ subscriptionService }) {
  return {
    async listRules(ctx) {
      ctx.body = createSuccessResponse(await subscriptionService.listRules());
    },
    async createRule(ctx) {
      ctx.status = 201;
      ctx.body = createSuccessResponse(
        await subscriptionService.createRule(ctx.request.body),
      );
    },
    async updateRule(ctx) {
      ctx.body = createSuccessResponse(
        await subscriptionService.updateRule(ctx.params.id, ctx.request.body),
      );
    },
    async deleteRule(ctx) {
      ctx.body = createSuccessResponse(
        await subscriptionService.deleteRule(ctx.params.id),
      );
    },
    async getMatchedSubscription(ctx) {
      const xml = await subscriptionService.buildSubscription('matched');
      ctx.set('Content-Type', 'text/xml; charset=utf-8');
      ctx.set('Cache-Control', 'no-store');
      ctx.body = xml;
    },
    async getUnmatchedSubscription(ctx) {
      const xml = await subscriptionService.buildSubscription('unmatched');
      ctx.set('Content-Type', 'text/xml; charset=utf-8');
      ctx.set('Cache-Control', 'no-store');
      ctx.body = xml;
    },
  };
}
