import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('未知路由返回统一格式的 404 响应', async () => {
  const response = await request(createApp().callback()).get('/unknown');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    code: 404,
    message: '接口不存在',
    data: null,
  });
});
