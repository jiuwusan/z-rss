import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createRssRepository } from '../src/repositories/rss.repository.js';
import { createRssService } from '../src/services/rss.service.js';
import { startTestServer, stopTestServer } from '../support/http-server.helper.js';

async function createApiFixture(fetchImpl = globalThis.fetch) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-api-'));
  const repository = createRssRepository({ dataDirectory });
  const rssService = createRssService({ repository, fetchImpl });
  const server = await startTestServer(createApp({ rssService }));
  return { dataDirectory, repository, server };
}

async function destroyApiFixture(fixture) {
  await stopTestServer(fixture.server);
  await rm(fixture.dataDirectory, { recursive: true, force: true });
}

test('平台 HTTP 接口完成新增、列表、修改和删除', async () => {
  const fixture = await createApiFixture();
  try {
    const created = await request(fixture.server)
      .post('/rss/platforms')
      .send({ platform: 'HDSKY', rss: 'https://example.com/old.xml' });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.platform, 'HDSKY');

    const listed = await request(fixture.server).get('/rss/platforms');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);

    const updated = await request(fixture.server)
      .put('/rss/platforms/hdsky')
      .send({ rss: 'https://example.com/new.xml' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.rss, 'https://example.com/new.xml');

    const deleted = await request(fixture.server).delete('/rss/platforms/HDSKY');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.platform, 'HDSKY');
  } finally {
    await destroyApiFixture(fixture);
  }
});

test('平台 HTTP 接口返回 400、404 和 409', async () => {
  const fixture = await createApiFixture();
  try {
    assert.equal((await request(fixture.server).post('/rss/platforms').send({})).status, 400);
    await request(fixture.server)
      .post('/rss/platforms')
      .send({ platform: 'A', rss: 'https://example.com/a.xml' });
    assert.equal(
      (await request(fixture.server)
        .post('/rss/platforms')
        .send({ platform: 'a', rss: 'https://example.com/b.xml' })).status,
      409,
    );
    assert.equal(
      (await request(fixture.server)
        .put('/rss/platforms/missing')
        .send({ rss: 'https://example.com/rss.xml' })).status,
      404,
    );
  } finally {
    await destroyApiFixture(fixture);
  }
});

test('刷新接口更新缓存且聚合接口只读取缓存', async () => {
  const rssXml = '<rss><channel><item><title>新条目</title><link>https://example.com/1</link><pubDate>2026-03-01T00:00:00Z</pubDate></item></channel></rss>';
  let fetchCalls = 0;
  const fixture = await createApiFixture(async () => {
    fetchCalls += 1;
    return new Response(rssXml);
  });
  try {
    await fixture.repository.savePlatforms([
      { platform: 'A', rss: 'https://example.com/a.xml' },
    ]);
    const refreshed = await request(fixture.server).post('/rss/cache/refresh');
    assert.equal(refreshed.status, 200);
    assert.deepEqual(
      {
        total: refreshed.body.data.total,
        success: refreshed.body.data.success,
        failed: refreshed.body.data.failed,
      },
      { total: 1, success: 1, failed: 0 },
    );
    assert.equal(fetchCalls, 1);

    const items = await request(fixture.server).get('/rss/items');
    assert.equal(items.status, 200);
    assert.equal(fetchCalls, 1);
    assert.equal(items.body.data[0].platform, 'A');
    assert.equal(items.body.data[0].title, '新条目');
    assert.equal(items.body.data[0].xml.startsWith('<item>'), true);
    assert.deepEqual(
      Object.keys(items.body.data[0]).sort(),
      ['link', 'platform', 'pubDate', 'title', 'xml'],
    );
  } finally {
    await destroyApiFixture(fixture);
  }
});
