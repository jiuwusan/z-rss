import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createRssRepository } from '../src/repositories/rss.repository.js';
import { createRssSubscriptionService } from '../src/services/rss-subscription.service.js';
import { createRssService } from '../src/services/rss.service.js';
import { startTestServer, stopTestServer } from '../support/http-server.helper.js';

async function createApiFixture() {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-subscription-api-'));
  const repository = createRssRepository({ dataDirectory });
  let fetchCalls = 0;
  const rssService = createRssService({
    repository,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('订阅读取不应发起外部请求');
    },
  });
  const subscriptionService = createRssSubscriptionService({ repository });
  const server = await startTestServer(createApp({ rssService, subscriptionService }));
  return {
    dataDirectory,
    repository,
    server,
    getFetchCalls: () => fetchCalls,
  };
}

async function destroyApiFixture(fixture) {
  await stopTestServer(fixture.server);
  await rm(fixture.dataDirectory, { recursive: true, force: true });
}

test('规则 CRUD 驱动匹配和未匹配订阅且只读取缓存', async () => {
  const fixture = await createApiFixture();

  try {
    await fixture.repository.saveItems([
      {
        platform: 'A',
        title: '2160p DV',
        pubDate: '2026-03-01T00:00:00Z',
        xml: '<item><title>2160p DV</title><guid isPermaLink="false">guid-dv</guid></item>',
      },
      {
        platform: 'A',
        title: '2160P WEB-DL',
        pubDate: '2026-03-02T00:00:00Z',
        xml: '<item><title>2160P WEB-DL</title><enclosure url="https://example.com/download?passkey=secret"/></item>',
      },
    ]);

    const created = await request(fixture.server)
      .post('/rss/rules')
      .send({ mustInclude: '2160p', mustExclude: 'DV' });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.mustInclude, '2160p');

    const listed = await request(fixture.server).get('/rss/rules');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);

    const matched = await request(fixture.server).get('/rss/subscriptions/matched');
    assert.equal(matched.status, 200);
    assert.match(matched.headers['content-type'], /^text\/xml; charset=utf-8$/);
    assert.equal(matched.headers['cache-control'], 'no-store');
    assert.match(matched.text, /2160P WEB-DL/);
    assert.doesNotMatch(matched.text, /2160p DV/);

    const unmatched = await request(fixture.server).get('/rss/subscriptions/unmatched');
    assert.equal(unmatched.status, 200);
    assert.match(unmatched.headers['content-type'], /^text\/xml; charset=utf-8$/);
    assert.equal(unmatched.headers['cache-control'], 'no-store');
    assert.match(unmatched.text, /2160p DV/);
    assert.doesNotMatch(unmatched.text, /2160P WEB-DL/);
    assert.equal(fixture.getFetchCalls(), 0);

    const updated = await request(fixture.server)
      .put(`/rss/rules/${created.body.data.id}`)
      .send({ mustInclude: '1080p', mustExclude: '' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.mustInclude, '1080p');

    const deleted = await request(fixture.server)
      .delete(`/rss/rules/${created.body.data.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.id, created.body.data.id);
  } finally {
    await destroyApiFixture(fixture);
  }
});

test('规则接口返回统一的 400 和 404 JSON 错误', async () => {
  const fixture = await createApiFixture();

  try {
    const invalid = await request(fixture.server)
      .post('/rss/rules')
      .send({ mustInclude: '[', mustExclude: '' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body, {
      code: 400,
      message: 'mustInclude 正则无效',
      data: null,
    });

    const missingUpdate = await request(fixture.server)
      .put('/rss/rules/missing')
      .send({ mustInclude: '2160p', mustExclude: '' });
    assert.equal(missingUpdate.status, 404);
    assert.equal(missingUpdate.body.code, 404);

    const missingDelete = await request(fixture.server)
      .delete('/rss/rules/missing');
    assert.equal(missingDelete.status, 404);
    assert.equal(missingDelete.body.code, 404);
  } finally {
    await destroyApiFixture(fixture);
  }
});

test('带 .xml 后缀的订阅路径不存在', async () => {
  const fixture = await createApiFixture();

  try {
    for (const kind of ['matched', 'unmatched']) {
      const response = await request(fixture.server)
        .get(`/rss/subscriptions/${kind}.xml`);
      assert.equal(response.status, 404);
      assert.equal(response.body.code, 404);
    }
  } finally {
    await destroyApiFixture(fixture);
  }
});
