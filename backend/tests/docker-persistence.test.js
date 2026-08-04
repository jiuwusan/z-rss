import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Docker 镜像复制前端、模板和 data 且 Compose 使用命名卷持久化', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const compose = await readFile(
    new URL('../../docker-compose.yml', import.meta.url),
    'utf8',
  );

  assert.match(dockerfile, /COPY --chown=node:node data \.\/data/);
  assert.match(dockerfile, /COPY --chown=node:node public \.\/public/);
  assert.match(dockerfile, /COPY --chown=node:node templates \.\/templates/);
  assert.match(compose, /- rss-data:\/app\/data/);
  assert.match(compose, /\nvolumes:\n  rss-data:/);
});
