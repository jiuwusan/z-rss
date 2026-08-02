import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';

test('未知异常转换为安全的 500 响应', async () => {
  const ctx = {};

  await errorMiddleware(ctx, async () => {
    throw new Error('敏感内部错误');
  });

  assert.equal(ctx.status, 500);
  assert.deepEqual(ctx.body, {
    code: 500,
    message: '服务器内部错误',
    data: null,
  });
  assert.equal(JSON.stringify(ctx.body).includes('敏感内部错误'), false);
  assert.equal(Object.hasOwn(ctx.body, 'stack'), false);
});
