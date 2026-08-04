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
  const originalSaveItems = repository.saveItems;
  let saveItemsCalls = 0;
  repository.saveItems = (items) => {
    saveItemsCalls += 1;
    return originalSaveItems(items);
  };
  const rssService = createRssService({ repository });
  const subscriptionService = createRssSubscriptionService({ repository });
  const server = await startTestServer(
    createApp({ rssService, subscriptionService }),
  );
  return {
    dataDirectory,
    repository,
    server,
    getSaveItemsCalls: () => saveItemsCalls,
  };
}

async function destroyApiFixture(fixture) {
  await stopTestServer(fixture.server);
  await rm(fixture.dataDirectory, { recursive: true, force: true });
}

test('规则 CRUD 驱动匹配和未匹配订阅且只读取缓存', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let fixture;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('订阅读取不应发起外部请求');
  };

  try {
    fixture = await createApiFixture();
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
    const saveItemsCallsBeforeRequests = fixture.getSaveItemsCalls();

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
    assert.equal(fetchCalls, 0);
    assert.equal(fixture.getSaveItemsCalls(), saveItemsCallsBeforeRequests);

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
    try {
      if (fixture) await destroyApiFixture(fixture);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('默认应用装配让规则 CRUD 与订阅服务共享注入的 repository', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-shared-repository-'));
  const repository = createRssRepository({ dataDirectory });
  let server;

  try {
    await repository.saveItems([
      {
        platform: 'A',
        title: '2160p WEB-DL',
        pubDate: '2026-03-02T00:00:00Z',
        xml: '<item><title>2160p WEB-DL</title></item>',
      },
    ]);
    await repository.saveRules([
      { id: 'seed-rule', mustInclude: '1080p', mustExclude: '' },
    ]);
    server = await startTestServer(createApp({ repository }));

    const initiallyListed = await request(server).get('/rss/rules');
    assert.equal(initiallyListed.status, 200);
    assert.deepEqual(initiallyListed.body.data, [
      { id: 'seed-rule', mustInclude: '1080p', mustExclude: '' },
    ]);

    const created = await request(server)
      .post('/rss/rules')
      .send({ mustInclude: '2160p', mustExclude: 'DV' });
    assert.equal(created.status, 201);

    const updated = await request(server)
      .put('/rss/rules/seed-rule')
      .send({ mustInclude: '720p', mustExclude: '' });
    assert.equal(updated.status, 200);

    const deleted = await request(server).delete('/rss/rules/seed-rule');
    assert.equal(deleted.status, 200);

    const matched = await request(server).get('/rss/subscriptions/matched');
    assert.equal(matched.status, 200);
    assert.match(matched.text, /2160p WEB-DL/);
    assert.deepEqual(await repository.listRules(), [created.body.data]);
  } finally {
    if (server) await stopTestServer(server);
    await rm(dataDirectory, { recursive: true, force: true });
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

test('重复规则 ID 使查询、修改和删除返回安全 500 且不改写数据', async () => {
  const fixture = await createApiFixture();
  const duplicateRules = [
    { id: 'duplicate', mustInclude: '2160p', mustExclude: '' },
    { id: 'duplicate', mustInclude: '1080p', mustExclude: '' },
  ];

  try {
    await fixture.repository.saveRules(duplicateRules);

    const responses = [
      await request(fixture.server).get('/rss/rules'),
      await request(fixture.server)
        .put('/rss/rules/duplicate')
        .send({ mustInclude: '720p', mustExclude: '' }),
      await request(fixture.server).delete('/rss/rules/duplicate'),
    ];

    for (const response of responses) {
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, {
        code: 500,
        message: '服务器内部错误',
        data: null,
      });
    }
    assert.deepEqual(await fixture.repository.listRules(), duplicateRules);
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

test('订阅生成失败返回统一的 500 JSON 响应', async () => {
  const server = await startTestServer(createApp({
    rssService: {},
    subscriptionService: {
      async buildSubscription() {
        throw new Error('母版读取失败');
      },
    },
  }));

  try {
    for (const kind of ['matched', 'unmatched']) {
      const response = await request(server).get(`/rss/subscriptions/${kind}`);

      assert.equal(response.status, 500);
      assert.match(
        response.headers['content-type'],
        /^application\/json; charset=utf-8$/,
      );
      assert.equal(response.headers['cache-control'], undefined);
      assert.deepEqual(response.body, {
        code: 500,
        message: '服务器内部错误',
        data: null,
      });
    }
  } finally {
    await stopTestServer(server);
  }
});

test('坏缓存中的畸形 item XML 返回统一的安全 500 JSON', async () => {
  const fixture = await createApiFixture();

  try {
    await fixture.repository.saveRules([
      { id: 'rule-1', mustInclude: '2160p', mustExclude: '' },
    ]);
    await fixture.repository.saveItems([
      {
        platform: 'A',
        title: '2160p 无效 XML',
        pubDate: '2026-03-02T00:00:00Z',
        xml: '<item><title>2160p</item>',
      },
    ]);

    const response = await request(fixture.server)
      .get('/rss/subscriptions/matched');

    assert.equal(response.status, 500);
    assert.match(
      response.headers['content-type'],
      /^application\/json; charset=utf-8$/,
    );
    assert.deepEqual(response.body, {
      code: 500,
      message: '服务器内部错误',
      data: null,
    });
  } finally {
    await destroyApiFixture(fixture);
  }
});
