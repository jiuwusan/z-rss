import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('GET /health 返回统一格式的健康状态', async () => {
  const response = await request(createApp().callback()).get('/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.equal(response.body.message, 'success');
  assert.equal(response.body.data.status, 'ok');
  assert.equal(typeof response.body.data.timestamp, 'string');
  assert.equal(Number.isNaN(Date.parse(response.body.data.timestamp)), false);
  assert.equal(typeof response.body.data.uptime, 'number');
});
