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
