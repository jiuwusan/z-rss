import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRssRepository } from '../src/repositories/rss.repository.js';

test('Docker 镜像使用安全空数据初始化命名卷且不复制本地运行数据', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const dockerIgnore = await readFile(
    new URL('../.dockerignore', import.meta.url),
    'utf8',
  );
  const compose = await readFile(
    new URL('../../docker-compose.yml', import.meta.url),
    'utf8',
  );
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const dockerDataUrl = new URL('../docker-data/', import.meta.url);

  assert.match(dockerIgnore, /(?:^|\n)data\/(?:\n|$)/);
  assert.match(dockerfile, /COPY --chown=node:node docker-data \.\/data/);
  assert.doesNotMatch(dockerfile, /COPY --chown=node:node data \.\/data/);
  assert.match(dockerfile, /COPY --chown=node:node public \.\/public/);
  assert.match(dockerfile, /COPY --chown=node:node templates \.\/templates/);
  assert.match(compose, /- rss-data:\/app\/data/);
  assert.match(compose, /\nvolumes:\n  rss-data:/);
  assert.deepEqual((await readdir(dockerDataUrl)).sort(), [
    'platforms.json',
    'rss-cache.json',
    'rss-rules.json',
  ]);
  for (const fileName of [
    'platforms.json',
    'rss-cache.json',
    'rss-rules.json',
  ]) {
    const seedContent = await readFile(new URL(fileName, dockerDataUrl), 'utf8');
    assert.equal(seedContent.trim(), '[]');
  }

  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-docker-data-'));
  try {
    for (const fileName of [
      'platforms.json',
      'rss-cache.json',
      'rss-rules.json',
    ]) {
      await copyFile(
        fileURLToPath(new URL(fileName, dockerDataUrl)),
        path.join(dataDirectory, fileName),
      );
    }

    const repository = createRssRepository({ dataDirectory });
    assert.deepEqual(await repository.listPlatforms(), []);
    assert.deepEqual(await repository.listItems(), []);
    assert.deepEqual(await repository.listRules(), []);

    await repository.savePlatforms([
      { platform: 'A', rss: 'https://example.com/rss.xml' },
    ]);
    await repository.saveItems([{ platform: 'A', title: '示例条目' }]);
    await repository.saveRules([
      { id: 'rule-1', mustInclude: '2160p', mustExclude: '' },
    ]);
    assert.equal((await repository.listPlatforms()).length, 1);
    assert.equal((await repository.listItems()).length, 1);
    assert.equal((await repository.listRules()).length, 1);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }

  assert.match(readme, /镜像不会复制本地 `data\/` 运行数据/);
  assert.match(readme, /首次创建 `rss-data` 命名卷时/);
  assert.match(readme, /`docker compose down -v` 会删除平台配置、RSS 缓存和分流规则/);
});
