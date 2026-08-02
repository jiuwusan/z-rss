import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  startTestServer,
  stopTestServer,
} from '../support/http-server.helper.js';

test('未知路由返回统一格式的 404 响应', async () => {
  const server = await startTestServer(createApp());
  const testRequest = request(server).get('/unknown');

  try {
    const response = await testRequest;

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      code: 404,
      message: '接口不存在',
      data: null,
    });
  } finally {
    testRequest.req?.destroy();
    await stopTestServer(server);
  }
});
