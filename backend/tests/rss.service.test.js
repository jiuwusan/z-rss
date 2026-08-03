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
