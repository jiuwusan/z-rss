import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  startTestServer,
  stopTestServer,
} from '../support/http-server.helper.js';

test('Koa 提供 RSS 管理台及静态资源', async () => {
  const server = await startTestServer(createApp());

  try {
    const [page, styles, script] = await Promise.all([
      request(server).get('/'),
      request(server).get('/styles.css'),
      request(server).get('/app.js'),
    ]);

    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.text, /id="platforms-panel"/);
    assert.match(page.text, /id="items-list"/);
    assert.match(page.text, /id="rules-panel"/);
    assert.match(page.text, /id="rule-dialog"/);
    assert.match(page.text, /id="matched-subscription-url"/);
    assert.match(page.text, /id="unmatched-subscription-url"/);
    assert.match(page.text, /id="platform-dialog"/);
    assert.match(page.text, /id="xml-dialog"/);
    assert.match(page.text, /<script type="module" src="\/app\.js"><\/script>/);

    assert.equal(styles.status, 200);
    assert.match(styles.headers['content-type'], /text\/css/);
    assert.match(styles.text, /@media/);

    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'], /javascript/);
  } finally {
    await stopTestServer(server);
  }
});

test('前端纯函数提供稳定的缺省展示与刷新摘要', async () => {
  const { formatDate, getDisplayTitle, summarizeRefresh } = await import(
    '../public/app.js'
  );

  assert.equal(getDisplayTitle({ title: '  ' }), '未命名条目');
  assert.equal(getDisplayTitle({ title: ' 示例标题 ' }), '示例标题');
  assert.equal(formatDate('invalid'), '时间未知');
  assert.match(formatDate('2026-08-03T08:00:00.000Z'), /2026/);
  assert.equal(
    summarizeRefresh({ total: 3, success: 2, failed: 1 }),
    '已更新 2 个平台，1 个失败',
  );
});

test('前端 API client 使用约定的 RSS 接口和请求方法', async () => {
  const { createApiClient } = await import('../public/app.js');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({ code: 0, message: 'success', data: { ok: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const api = createApiClient(fetchImpl);

  await api.listPlatforms();
  await api.listItems();
  await api.createPlatform({ platform: 'A', rss: 'https://example.com/a.xml' });
  await api.updatePlatform('A B', { rss: 'https://example.com/b.xml' });
  await api.deletePlatform('A B');
  await api.refreshCache();
  await api.listRules();
  await api.createRule({ mustInclude: '2160p', mustExclude: 'DV' });
  await api.updateRule('rule 1', { mustInclude: '1080p', mustExclude: '' });
  await api.deleteRule('rule 1');

  assert.deepEqual(
    calls.map(({ url, options }) => [url, options.method || 'GET']),
    [
      ['/rss/platforms', 'GET'],
      ['/rss/items', 'GET'],
      ['/rss/platforms', 'POST'],
      ['/rss/platforms/A%20B', 'PUT'],
      ['/rss/platforms/A%20B', 'DELETE'],
      ['/rss/cache/refresh', 'POST'],
      ['/rss/rules', 'GET'],
      ['/rss/rules', 'POST'],
      ['/rss/rules/rule%201', 'PUT'],
      ['/rss/rules/rule%201', 'DELETE'],
    ],
  );
  assert.equal(
    calls[2].options.body,
    JSON.stringify({ platform: 'A', rss: 'https://example.com/a.xml' }),
  );
  assert.equal(
    calls[7].options.body,
    JSON.stringify({ mustInclude: '2160p', mustExclude: 'DV' }),
  );
  assert.equal(
    calls[8].options.body,
    JSON.stringify({ mustInclude: '1080p', mustExclude: '' }),
  );
});

test('前端规则校验限制必含表达式和字段长度', async () => {
  const { validateRuleInput } = await import('../public/app.js');

  assert.equal(
    validateRuleInput({ mustInclude: '', mustExclude: '' }),
    '请填写必含表达式',
  );
  assert.equal(
    validateRuleInput({ mustInclude: 'a'.repeat(257), mustExclude: '' }),
    '必含表达式不能超过 256 个字符',
  );
  assert.equal(
    validateRuleInput({ mustInclude: '2160p', mustExclude: 'a'.repeat(257) }),
    '排除表达式不能超过 256 个字符',
  );
  assert.equal(
    validateRuleInput({ mustInclude: '2160p', mustExclude: 'DV' }),
    '',
  );
});

test('前端 API client 优先抛出后端错误消息', async () => {
  const { createApiClient } = await import('../public/app.js');
  const api = createApiClient(async () =>
    new Response(JSON.stringify({ code: 409, message: '缓存刷新正在进行' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }),
  );

  await assert.rejects(() => api.refreshCache(), /缓存刷新正在进行/);
});
