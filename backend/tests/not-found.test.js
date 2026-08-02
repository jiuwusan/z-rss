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

  try {
    const response = await request(server).get('/unknown');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      code: 404,
      message: '接口不存在',
      data: null,
    });
  } finally {
    await stopTestServer(server);
  }
});
