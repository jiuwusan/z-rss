import { createSuccessResponse } from '../utils/response.util.js';

/**
 * 创建 RSS Controller。
 * @param {{ rssService: object }} dependencies Controller 依赖
 * @returns {object} Koa 路由处理方法
 */
export function createRssController({ rssService }) {
  return {
    async listPlatforms(ctx) {
      ctx.body = createSuccessResponse(await rssService.listPlatforms());
    },
    async createPlatform(ctx) {
      ctx.status = 201;
      ctx.body = createSuccessResponse(
        await rssService.createPlatform(ctx.request.body),
      );
    },
    async updatePlatform(ctx) {
      ctx.body = createSuccessResponse(
        await rssService.updatePlatform(ctx.params.platform, ctx.request.body),
      );
    },
    async deletePlatform(ctx) {
      ctx.body = createSuccessResponse(
        await rssService.deletePlatform(ctx.params.platform),
      );
    },
    async refreshCache(ctx) {
      ctx.body = createSuccessResponse(await rssService.refreshCache());
    },
    async listItems(ctx) {
      ctx.body = createSuccessResponse(await rssService.listItems());
    },
  };
}
