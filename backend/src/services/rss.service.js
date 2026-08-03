import { createRssRepository } from '../repositories/rss.repository.js';
import { createHttpError } from '../utils/http-error.util.js';

let writeQueue = Promise.resolve();

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
 * 创建 RSS 业务服务。
 * @param {{ repository?: ReturnType<typeof createRssRepository> }} options 依赖
 */
export function createRssService({ repository = createRssRepository() } = {}) {
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

  return { listPlatforms, createPlatform, updatePlatform, deletePlatform };
}
