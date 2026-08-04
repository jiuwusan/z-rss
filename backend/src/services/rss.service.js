import { parseRssItems } from '../parsers/rss.parser.js';
import { createRssRepository } from '../repositories/rss.repository.js';
import { createHttpError } from '../utils/http-error.util.js';
import { sortRssItems } from '../utils/rss-item.util.js';

let writeQueue = Promise.resolve();
let isRefreshing = false;

function normalizePlatformKey(platform) {
  return platform.trim().toLowerCase();
}

function validatePlatform(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createHttpError(400, 'platform 不能为空');
  }
  return value.trim();
}

function validateRssUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createHttpError(400, 'rss 不能为空');
  }

  let rssUrl;
  try {
    rssUrl = new URL(value.trim());
  } catch {
    throw createHttpError(400, 'rss 地址无效');
  }

  if (!['http:', 'https:'].includes(rssUrl.protocol)) {
    throw createHttpError(400, 'rss 只支持 HTTP 或 HTTPS');
  }
  return rssUrl.toString();
}

/**
 * 创建 RSS 平台、刷新与聚合业务服务。
 * @param {object} options 服务依赖
 * @returns {object} RSS 业务方法集合
 */
export function createRssService({
  repository = createRssRepository(),
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 10_000,
} = {}) {
  async function withWriteLock(operation) {
    const previousWrite = writeQueue;
    let releaseWrite;
    writeQueue = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;
    try {
      return await operation();
    } finally {
      releaseWrite();
    }
  }

  async function listPlatforms() {
    return repository.listPlatforms();
  }

  async function createPlatform(input = {}) {
    return withWriteLock(async () => {
      const platform = validatePlatform(input.platform);
      const rss = validateRssUrl(input.rss);
      const platforms = await repository.listPlatforms();
      const platformKey = normalizePlatformKey(platform);
      if (platforms.some((item) => normalizePlatformKey(item.platform) === platformKey)) {
        throw createHttpError(409, '平台已存在');
      }
      const createdPlatform = { platform, rss };
      await repository.savePlatforms([...platforms, createdPlatform]);
      return createdPlatform;
    });
  }

  async function updatePlatform(platformName, input = {}) {
    return withWriteLock(async () => {
      const platformKey = normalizePlatformKey(validatePlatform(platformName));
      const rss = validateRssUrl(input.rss);
      const platforms = await repository.listPlatforms();
      const platformIndex = platforms.findIndex(
        (item) => normalizePlatformKey(item.platform) === platformKey,
      );
      if (platformIndex === -1) throw createHttpError(404, '平台不存在');
      const updatedPlatform = { ...platforms[platformIndex], rss };
      platforms[platformIndex] = updatedPlatform;
      await repository.savePlatforms(platforms);
      return updatedPlatform;
    });
  }

  async function deletePlatform(platformName) {
    return withWriteLock(async () => {
      const platformKey = normalizePlatformKey(validatePlatform(platformName));
      const platforms = await repository.listPlatforms();
      const platformIndex = platforms.findIndex(
        (item) => normalizePlatformKey(item.platform) === platformKey,
      );
      if (platformIndex === -1) throw createHttpError(404, '平台不存在');
      const [deletedPlatform] = platforms.splice(platformIndex, 1);
      const items = await repository.listItems();
      const remainingItems = items.filter(
        (item) => normalizePlatformKey(item.platform) !== platformKey,
      );
      await repository.saveItems(remainingItems);
      await repository.savePlatforms(platforms);
      return deletedPlatform;
    });
  }

  async function refreshPlatform(platform) {
    const requestController = new AbortController();
    const requestTimeout = setTimeout(() => {
      requestController.abort(new DOMException('RSS 请求超时', 'TimeoutError'));
    }, requestTimeoutMs);

    try {
      const response = await fetchImpl(platform.rss, {
        signal: requestController.signal,
      });
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // 响应体释放失败不应改变平台级刷新结果或泄漏内部错误。
        }
        return {
          result: {
            platform: platform.platform,
            status: 'failed',
            message: `RSS 请求返回 HTTP ${response.status}`,
          },
        };
      }

      const parsedItems = parseRssItems(await response.text()).map((item) => ({
        platform: platform.platform,
        ...item,
      }));
      return {
        items: parsedItems,
        result: {
          platform: platform.platform,
          status: 'success',
          itemCount: parsedItems.length,
        },
      };
    } catch (error) {
      const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return {
        result: {
          platform: platform.platform,
          status: 'failed',
          message: isTimeout ? 'RSS 请求超时' : 'RSS 拉取或解析失败',
        },
      };
    } finally {
      clearTimeout(requestTimeout);
    }
  }

  async function refreshCache() {
    if (isRefreshing) throw createHttpError(409, '缓存刷新正在进行');
    isRefreshing = true;

    try {
      return await withWriteLock(async () => {
        const platforms = await repository.listPlatforms();
        const currentItems = await repository.listItems();
        const outcomes = await Promise.all(platforms.map(refreshPlatform));
        const successfulPlatformKeys = new Set(
          outcomes
            .filter((outcome) => outcome.result.status === 'success')
            .map((outcome) => normalizePlatformKey(outcome.result.platform)),
        );
        const nextItems = currentItems.filter(
          (item) => !successfulPlatformKeys.has(normalizePlatformKey(item.platform)),
        );
        for (const outcome of outcomes) {
          if (outcome.items) nextItems.push(...outcome.items);
        }
        if (successfulPlatformKeys.size > 0) {
          await repository.saveItems(nextItems);
        }

        const success = outcomes.filter(
          (outcome) => outcome.result.status === 'success',
        ).length;
        return {
          total: platforms.length,
          success,
          failed: platforms.length - success,
          results: outcomes.map((outcome) => outcome.result),
        };
      });
    } finally {
      isRefreshing = false;
    }
  }

  async function listItems() {
    const items = await repository.listItems();
    const publicItems = items.map((item) => ({
      platform: item.platform,
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      xml: item.xml,
    }));
    return sortRssItems(publicItems);
  }

  return {
    listPlatforms,
    createPlatform,
    updatePlatform,
    deletePlatform,
    refreshCache,
    listItems,
  };
}
