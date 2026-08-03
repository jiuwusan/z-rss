import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRssItems } from '../src/parsers/rss.parser.js';

const RSS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Example</title>
    <item>
      <title><![CDATA[ A & B ]]></title>
      <link>https://example.com/details?id=1&amp;from=rss</link>
      <pubDate>Thu, 26 Mar 2026 16:35:43 +0800</pubDate>
    </item>
    <item><description>只有描述</description></item>
  </channel>
</rss>`;

test('解析 item 字段并完整保留原始 XML', () => {
  const items = parseRssItems(RSS_XML);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'A & B',
    link: 'https://example.com/details?id=1&from=rss',
    pubDate: 'Thu, 26 Mar 2026 16:35:43 +0800',
    xml: `<item>
      <title><![CDATA[ A & B ]]></title>
      <link>https://example.com/details?id=1&amp;from=rss</link>
      <pubDate>Thu, 26 Mar 2026 16:35:43 +0800</pubDate>
    </item>`,
  });
  assert.deepEqual(items[1], {
    title: '',
    link: '',
    pubDate: '',
    xml: '<item><description>只有描述</description></item>',
  });
});

test('有效空 RSS 返回空数组', () => {
  const items = parseRssItems('<rss><channel><title>Empty</title></channel></rss>');

  assert.deepEqual(items, []);
});

test('格式错误或缺少 channel 的 XML 被拒绝', () => {
  assert.throws(() => parseRssItems('<rss><channel>'), /RSS XML 格式错误/);
  assert.throws(() => parseRssItems('<root />'), /RSS channel 不存在/);
});
