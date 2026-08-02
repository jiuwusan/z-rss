import assert from 'node:assert/strict';
import test from 'node:test';
import { getConfig } from '../src/config/index.js';

test('未提供环境变量时使用默认配置', () => {
  assert.deepEqual(getConfig({}), {
    port: 3000,
    nodeEnv: 'development',
  });
});

test('环境变量覆盖默认配置', () => {
  assert.deepEqual(getConfig({ PORT: '4100', NODE_ENV: 'test' }), {
    port: 4100,
    nodeEnv: 'test',
  });
});
