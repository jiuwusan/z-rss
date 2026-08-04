import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRssRepository } from '../src/repositories/rss.repository.js';
import {
  createRssSubscriptionService,
  partitionItems,
} from '../src/services/rss-subscription.service.js';
import { sortRssItems } from '../src/utils/rss-item.util.js';

const TEMPLATE_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
    <channel>
        <title>Cloud Jiuwusan Torrents</title>
        <link>
            <![CDATA[https://cloud.jiuwusan.cn]]>
        </link>
        <description>
            <![CDATA[Latest torrents from Jiuwusan - 自定义 RSS 订阅]]>
        </description>
        <language>zh-cn</language>
        <copyright>Copyright (c) Jiuwusan 2013-2026, all rights reserved</copyright>
        <managingEditor>admin@jiuwusan.cn (Jiuwusan Admin)</managingEditor>
        <webMaster>admin@jiuwusan.cn (Jiuwusan Webmaster)</webMaster>
        <pubDate>Thu, 26 Mar 2026 17:10:59 +0800</pubDate>
        <generator>NexusPHP RSS Generator</generator>
        <docs>
            <![CDATA[http://www.rssboard.org/rss-specification]]>
        </docs>
        <ttl>60</ttl>
        <image>
            <url>
                <![CDATA[https://cloud.jiuwusan.cn/pic/rss_logo.jpg]]>
            </url>
            <title>Cloud Jiuwusan Torrents</title>
            <link>
                <![CDATA[https://cloud.jiuwusan.cn]]>
            </link>
            <width>100</width>
            <height>100</height>
            <description>Cloud Jiuwusan Torrents</description>
        </image>
        <!-- 在这里插入 item 标签内容 -->
    </channel>
</rss>`;

async function createServiceFixture(createId = () => 'rule-1') {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-subscription-'));
  const repository = createRssRepository({ dataDirectory });
  const templatePath = path.join(dataDirectory, 'subscription.xml');
  await writeFile(templatePath, TEMPLATE_XML, 'utf8');
  return {
    dataDirectory,
    repository,
    templatePath,
    service: createRssSubscriptionService({ repository, createId, templatePath }),
  };
}

test('规则 CRUD 保存必含和必不含正则', async () => {
  const fixture = await createServiceFixture();

  try {
    const created = await fixture.service.createRule({
      mustInclude: '2160p|4K',
      mustExclude: 'DV',
    });
    assert.deepEqual(created, {
      id: 'rule-1',
      mustInclude: '2160p|4K',
      mustExclude: 'DV',
    });
    assert.deepEqual(await fixture.service.listRules(), [created]);
    assert.equal(
      (await fixture.service.updateRule('rule-1', {
        mustInclude: '1080p',
        mustExclude: '',
      })).mustInclude,
      '1080p',
    );
    assert.equal((await fixture.service.deleteRule('rule-1')).id, 'rule-1');
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('创建和修改规则时省略 mustExclude 会规范化为空字符串', async () => {
  const fixture = await createServiceFixture();

  try {
    const created = await fixture.service.createRule({ mustInclude: '2160p' });
    assert.equal(created.mustExclude, '');

    const updated = await fixture.service.updateRule(created.id, {
      mustInclude: '1080p',
    });
    assert.equal(updated.mustExclude, '');
    assert.deepEqual(await fixture.service.listRules(), [updated]);
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('规则 CRUD 拒绝无效输入与不存在 ID', async () => {
  const fixture = await createServiceFixture();

  try {
    const invalidInputs = [
      { mustInclude: '', mustExclude: '' },
      { mustInclude: 1, mustExclude: '' },
      { mustInclude: '2160p', mustExclude: 1 },
      { mustInclude: '[', mustExclude: '' },
      { mustInclude: '2160p', mustExclude: '[' },
      { mustInclude: 'a'.repeat(257), mustExclude: '' },
      { mustInclude: '2160p', mustExclude: 'a'.repeat(257) },
    ];

    for (const input of invalidInputs) {
      await assert.rejects(
        () => fixture.service.createRule(input),
        (error) => error.status === 400,
      );
    }

    await assert.rejects(
      () => fixture.service.updateRule('missing', {
        mustInclude: '2160p',
        mustExclude: '',
      }),
      (error) => error.status === 404,
    );
    await assert.rejects(
      () => fixture.service.deleteRule('missing'),
      (error) => error.status === 404,
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('规则数量超过 100 条时返回 400', async () => {
  const fixture = await createServiceFixture();

  try {
    await fixture.repository.saveRules(Array.from({ length: 100 }, (_, index) => ({
      id: `rule-${index}`,
      mustInclude: '2160p',
      mustExclude: '',
    })));

    await assert.rejects(
      () => fixture.service.createRule({ mustInclude: '1080p', mustExclude: '' }),
      (error) => error.status === 400,
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('同目录的服务实例并发创建规则时保留全部规则', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-subscription-'));
  const firstService = createRssSubscriptionService({
    repository: createRssRepository({ dataDirectory }),
    createId: () => 'rule-1',
  });
  const secondService = createRssSubscriptionService({
    repository: createRssRepository({ dataDirectory }),
    createId: () => 'rule-2',
  });

  try {
    await Promise.all([
      firstService.createRule({ mustInclude: '2160p', mustExclude: '' }),
      secondService.createRule({ mustInclude: '1080p', mustExclude: '' }),
    ]);

    assert.deepEqual(
      (await firstService.listRules()).map((rule) => rule.id).sort(),
      ['rule-1', 'rule-2'],
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('无效持久化规则会抛出未标记 HTTP 状态的错误', async () => {
  const fixture = await createServiceFixture();

  try {
    await fixture.repository.saveRules([
      { id: 'invalid', mustInclude: '[', mustExclude: '' },
    ]);

    await assert.rejects(
      () => fixture.service.listRules(),
      (error) => error.status === undefined,
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('持久化规则要求非空字符串 ID 和字符串 mustExclude', async () => {
  const fixture = await createServiceFixture();
  const invalidRules = [
    { id: 'rule-1', mustInclude: '2160p' },
    { mustInclude: '2160p', mustExclude: '' },
    { id: '', mustInclude: '2160p', mustExclude: '' },
    { id: 1, mustInclude: '2160p', mustExclude: '' },
  ];

  try {
    for (const rule of invalidRules) {
      await fixture.repository.saveRules([rule]);
      await assert.rejects(
        () => fixture.service.listRules(),
        (error) => error.status === undefined,
      );
    }
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('分流规则按日期排序后匹配条目标题', () => {
  const items = [
    { title: '2160p DV', pubDate: '2026-03-02T00:00:00Z' },
    { title: '1080p WEB-DL', pubDate: '2026-03-03T00:00:00Z' },
    { title: '2160P WEB-DL', pubDate: '2026-03-04T00:00:00Z' },
    { title: '', pubDate: 'invalid' },
  ];
  const result = partitionItems(items, [
    { id: '1', mustInclude: '2160p', mustExclude: 'dv' },
    { id: '2', mustInclude: '1080p.*WEB-DL', mustExclude: '' },
  ]);

  assert.deepEqual(result.matched.map((item) => item.title), [
    '2160P WEB-DL',
    '1080p WEB-DL',
  ]);
  assert.deepEqual(result.unmatched.map((item) => item.title), [
    '2160p DV',
    '',
  ]);
  assert.deepEqual(partitionItems(items, []).matched, []);
  assert.equal(partitionItems(items, []).unmatched.length, items.length);
});

test('空标题和非字符串标题不会被可匹配空串的正则命中', () => {
  const items = [
    { title: '', pubDate: '2026-03-03T00:00:00Z' },
    { title: null, pubDate: '2026-03-02T00:00:00Z' },
    { pubDate: '2026-03-01T00:00:00Z' },
  ];

  for (const mustInclude of ['.*', '^$', 'a*']) {
    const result = partitionItems(items, [
      { id: '1', mustInclude, mustExclude: '' },
    ]);
    assert.deepEqual(result.matched, []);
    assert.deepEqual(result.unmatched, items);
  }
});

test('RSS 条目排序保持同日期和无效日期的原始相对顺序', () => {
  const items = [
    { title: '同日期一', pubDate: '2026-03-01T00:00:00Z' },
    { title: '无效日期一', pubDate: 'invalid' },
    { title: '较晚', pubDate: '2026-03-02T00:00:00Z' },
    { title: '同日期二', pubDate: '2026-03-01T00:00:00Z' },
    { title: '无效日期二', pubDate: '' },
  ];

  assert.deepEqual(
    sortRssItems(items).map((item) => item.title),
    ['较晚', '同日期一', '同日期二', '无效日期一', '无效日期二'],
  );
});

test('订阅生成保留原始 item XML 并按规则输出匹配条目', async () => {
  const fixture = await createServiceFixture();

  try {
    await fixture.repository.saveItems([
      {
        platform: 'A',
        title: '较早 2160p DV',
        pubDate: '2026-03-01T00:00:00Z',
        xml: '<item><title>较早 2160p DV</title><enclosure url="https://example.com/download?passkey=excluded" length="2" type="application/x-bittorrent"/><guid isPermaLink="false">guid-2</guid></item>',
      },
      {
        platform: 'A',
        title: '较晚 2160P WEB-DL',
        pubDate: '2026-03-02T00:00:00Z',
        xml: '<item><title>较晚 2160P WEB-DL</title><enclosure url="https://example.com/download?passkey=secret" length="1" type="application/x-bittorrent"/><guid isPermaLink="false">guid-1</guid></item>',
      },
    ]);
    await fixture.repository.saveRules([
      { id: 'rule-1', mustInclude: '2160p', mustExclude: 'DV' },
    ]);

    const xml = await fixture.service.buildSubscription('matched');

    assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
    assert.match(xml, /<enclosure url="https:\/\/example\.com\/download\?passkey=secret"/);
    assert.match(xml, /<guid isPermaLink="false">guid-1<\/guid>/);
    assert.doesNotMatch(xml, /在这里插入 item 标签内容/);
    assert.equal(xml.indexOf('较晚'), xml.lastIndexOf('较晚'));
    assert.doesNotMatch(xml, /较早 2160p DV/);
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('空命中订阅保留 RSS 和 channel 母版且不输出 item', async () => {
  const fixture = await createServiceFixture();

  try {
    await fixture.repository.saveItems([
      {
        platform: 'A',
        title: '1080p WEB-DL',
        pubDate: '2026-03-01T00:00:00Z',
        xml: '<item><title>1080p WEB-DL</title></item>',
      },
    ]);
    await fixture.repository.saveRules([
      { id: 'rule-1', mustInclude: '2160p', mustExclude: '' },
    ]);

    const xml = await fixture.service.buildSubscription('matched');

    assert.match(xml, /<rss\b/);
    assert.match(xml, /<channel>/);
    assert.doesNotMatch(xml, /<item>/);
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('订阅母版缺少唯一占位符时拒绝生成', async () => {
  const fixture = await createServiceFixture();

  try {
    await writeFile(
      fixture.templatePath,
      '<rss><channel></channel></rss>',
      'utf8',
    );

    await assert.rejects(
      () => fixture.service.buildSubscription('matched'),
      /RSS 订阅母版占位符无效/,
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test('订阅类型仅允许 matched 和 unmatched', async () => {
  const fixture = await createServiceFixture();

  try {
    await assert.rejects(
      () => fixture.service.buildSubscription('unknown'),
      (error) => error.status === 404,
    );
  } finally {
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});
