import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRssRepository } from '../src/repositories/rss.repository.js';
import { createRssService } from '../src/services/rss.service.js';

async function createServiceFixture() {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-service-'));
  const repository = createRssRepository({ dataDirectory });
  return {
    dataDirectory,
    repository,
    service: createRssService({ repository }),
  };
}

test('平台 CRUD 使用不区分大小写的唯一键', async () => {
  const fixture = await createServiceFixture();

  try {
    const created = await fixture.service.createPlatform({
      platform: 'HDSKY',
      rss: 'https://example.com/old.xml',
    });
    assert.equal(created.platform, 'HDSKY');
    await assert.rejects(
      () => fixture.service.createPlatform({
        platform: 'hdsky',
        rss: 'https://example.com/duplicate.xml',
      }),
      (error) => error.status === 409,
    );

    const updated = await fixture.service.updatePlatform('hdsky', {
      rss: 'https://example.com/new.xml',
    });
    assert.equal(updated.rss, 'https://example.com/new.xml');

    await fixture.repository.saveItems([
      { platform: 'HDSKY', title: '', link: '', pubDate: '', xml: '<item />' },
    ]);
    await fixture.service.deletePlatform('HdSky');
    assert.deepEqual(await fixture.service.listPlatforms(), []);
    assert.deepEqual(await fixture.repository.listItems(), []);
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('平台 CRUD 校验字段、协议和不存在状态', async () => {
  const fixture = await createServiceFixture();

  try {
    await assert.rejects(
      () => fixture.service.createPlatform({ platform: '', rss: 'https://example.com' }),
      (error) => error.status === 400,
    );
    await assert.rejects(
      () => fixture.service.createPlatform({ platform: 'FTP', rss: 'ftp://example.com/rss' }),
      (error) => error.status === 400,
    );
    await assert.rejects(
      () => fixture.service.updatePlatform('missing', { rss: 'https://example.com/rss' }),
      (error) => error.status === 404,
    );
    await assert.rejects(
      () => fixture.service.deletePlatform('missing'),
      (error) => error.status === 404,
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('同目录的服务实例并发创建不同平台时保留全部平台', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-service-'));
  const firstService = createRssService({
    repository: createRssRepository({ dataDirectory }),
  });
  const secondService = createRssService({
    repository: createRssRepository({ dataDirectory }),
  });

  try {
    await Promise.all([
      firstService.createPlatform({
        platform: 'HDSKY',
        rss: 'https://example.com/hdsky.xml',
      }),
      secondService.createPlatform({
        platform: 'HHCLUB',
        rss: 'https://example.com/hhclub.xml',
      }),
    ]);

    assert.deepEqual(
      (await firstService.listPlatforms()).map((item) => item.platform).sort(),
      ['HDSKY', 'HHCLUB'],
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('同目录的服务实例并发创建大小写不同的平台时只允许一个成功', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-service-'));
  const firstService = createRssService({
    repository: createRssRepository({ dataDirectory }),
  });
  const secondService = createRssService({
    repository: createRssRepository({ dataDirectory }),
  });

  try {
    const results = await Promise.allSettled([
      firstService.createPlatform({
        platform: 'HDSKY',
        rss: 'https://example.com/hdsky.xml',
      }),
      secondService.createPlatform({
        platform: 'hdsky',
        rss: 'https://example.com/duplicate.xml',
      }),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter(
        (result) => result.status === 'rejected' && result.reason.status === 409,
      ).length,
      1,
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('刷新成功平台并保留失败平台旧缓存', async () => {
  const fixture = await createServiceFixture();
  const successXml = '<rss><channel><item><title>新条目</title><link>https://example.com/new</link><pubDate>Thu, 26 Mar 2026 16:35:43 +0800</pubDate></item></channel></rss>';
  const fetchImpl = async (url) => {
    if (url.includes('success')) return new Response(successXml, { status: 200 });
    return new Response('failed', { status: 503 });
  };
  const service = createRssService({ repository: fixture.repository, fetchImpl });

  try {
    await fixture.repository.savePlatforms([
      { platform: 'SUCCESS', rss: 'https://example.com/success' },
      { platform: 'FAILED', rss: 'https://example.com/failure' },
    ]);
    await fixture.repository.saveItems([
      { platform: 'SUCCESS', title: '旧成功', link: '', pubDate: '', xml: '<item />' },
      { platform: 'FAILED', title: '保留条目', link: '', pubDate: '', xml: '<item />' },
    ]);

    const result = await service.refreshCache();
    const items = await fixture.repository.listItems();

    assert.deepEqual(
      { total: result.total, success: result.success, failed: result.failed },
      { total: 2, success: 1, failed: 1 },
    );
    assert.equal(items.some((item) => item.title === '新条目'), true);
    assert.equal(items.some((item) => item.title === '旧成功'), false);
    assert.equal(items.some((item) => item.title === '保留条目'), true);
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('有效空 RSS 清空平台缓存且聚合列表按日期倒序', async () => {
  const fixture = await createServiceFixture();
  const service = createRssService({
    repository: fixture.repository,
    fetchImpl: async () => new Response('<rss><channel /></rss>', { status: 200 }),
  });

  try {
    await fixture.repository.savePlatforms([
      { platform: 'EMPTY', rss: 'https://example.com/empty' },
    ]);
    await fixture.repository.saveItems([
      { platform: 'EMPTY', title: '待清空', link: '', pubDate: '', xml: '<item />' },
      { platform: 'OTHER', title: '较早', link: '', pubDate: '2026-01-01T00:00:00Z', xml: '<item />' },
      { platform: 'OTHER', title: '无日期', link: '', pubDate: 'invalid', xml: '<item />' },
      { platform: 'OTHER', title: '较晚', link: '', pubDate: '2026-03-01T00:00:00Z', xml: '<item />' },
    ]);

    await service.refreshCache();
    assert.deepEqual(
      (await service.listItems()).map((item) => item.title),
      ['较晚', '较早', '无日期'],
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('刷新执行期间重复刷新返回 409', async () => {
  const fixture = await createServiceFixture();
  let releaseFetch;
  let signalFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    signalFetchStarted = resolve;
  });
  const fetchImpl = () => new Promise((resolve) => {
    releaseFetch = () => resolve(new Response('<rss><channel /></rss>'));
    signalFetchStarted();
  });
  const service = createRssService({ repository: fixture.repository, fetchImpl });

  try {
    await fixture.repository.savePlatforms([
      { platform: 'WAIT', rss: 'https://example.com/wait' },
    ]);
    const firstRefresh = service.refreshCache();
    await fetchStarted;
    await assert.rejects(() => service.refreshCache(), (error) => error.status === 409);
    releaseFetch();
    await firstRefresh;
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('不同服务实例之间的重复刷新返回 409', async () => {
  const fixture = await createServiceFixture();
  let releaseFetch;
  let signalFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    signalFetchStarted = resolve;
  });
  const firstService = createRssService({
    repository: fixture.repository,
    fetchImpl: () => new Promise((resolve) => {
      releaseFetch = () => resolve(new Response('<rss><channel /></rss>'));
      signalFetchStarted();
    }),
  });
  const secondService = createRssService({ repository: fixture.repository });

  try {
    await fixture.repository.savePlatforms([
      { platform: 'WAIT', rss: 'https://example.com/wait' },
    ]);
    const firstRefresh = firstService.refreshCache();
    await fetchStarted;
    await assert.rejects(() => secondService.refreshCache(), (error) => error.status === 409);
    releaseFetch();
    await firstRefresh;
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('RSS 请求超时只标记当前平台失败并保留旧缓存', async () => {
  const fixture = await createServiceFixture();
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const service = createRssService({
    repository: fixture.repository,
    fetchImpl,
    requestTimeoutMs: 10,
  });

  try {
    await fixture.repository.savePlatforms([
      { platform: 'TIMEOUT', rss: 'https://example.com/timeout' },
    ]);
    await fixture.repository.saveItems([
      { platform: 'TIMEOUT', title: '旧缓存', link: '', pubDate: '', xml: '<item />' },
    ]);

    const result = await service.refreshCache();
    assert.equal(result.results[0].status, 'failed');
    assert.equal(result.results[0].message, 'RSS 请求超时');
    assert.equal((await fixture.repository.listItems())[0].title, '旧缓存');
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('聚合列表只返回公开字段', async () => {
  const fixture = await createServiceFixture();

  try {
    await fixture.repository.saveItems([
      {
        platform: 'LEGACY',
        title: '历史条目',
        link: 'https://example.com/legacy',
        pubDate: '2026-03-01T00:00:00Z',
        xml: '<item />',
        legacyField: '不应泄漏',
      },
    ]);

    const [item] = await fixture.service.listItems();
    assert.deepEqual(
      Object.keys(item),
      ['platform', 'title', 'link', 'pubDate', 'xml'],
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});
