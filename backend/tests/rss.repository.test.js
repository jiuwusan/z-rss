import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRssRepository } from '../src/repositories/rss.repository.js';

test('缺少数据文件时初始化空数组并支持再次读取', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-repository-'));
  const repository = createRssRepository({ dataDirectory });

  try {
    assert.deepEqual(await repository.listPlatforms(), []);
    assert.deepEqual(await repository.listItems(), []);

    await repository.savePlatforms([
      { platform: 'HDSKY', rss: 'https://example.com/rss.xml' },
    ]);
    await repository.saveItems([
      {
        platform: 'HDSKY',
        title: '标题',
        link: 'https://example.com/1',
        pubDate: '',
        xml: '<item />',
      },
    ]);

    assert.equal((await repository.listPlatforms())[0].platform, 'HDSKY');
    assert.equal((await repository.listItems())[0].title, '标题');
    assert.deepEqual(
      (await readdir(dataDirectory)).sort(),
      ['platforms.json', 'rss-cache.json'],
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('损坏 JSON 会抛错且不会被静默覆盖', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-repository-'));
  const repository = createRssRepository({ dataDirectory });

  try {
    await writeFile(path.join(dataDirectory, 'platforms.json'), '{bad', 'utf8');
    await assert.rejects(() => repository.listPlatforms(), SyntaxError);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('并发初始化与保存不会覆盖已保存的平台数据', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-repository-'));
  const repository = createRssRepository({ dataDirectory });
  const platforms = [
    { platform: 'HDSKY', rss: 'https://example.com/rss.xml' },
  ];

  try {
    const initialization = repository.listPlatforms();
    const saving = repository.savePlatforms(platforms);

    await Promise.all([initialization, saving]);

    assert.deepEqual(await repository.listPlatforms(), platforms);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
