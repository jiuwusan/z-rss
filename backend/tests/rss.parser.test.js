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

test('CDATA 中的 item 字面文本不会生成或截断条目', () => {
  const itemXml = `<item data-note="1 > 0">
      <title>真实条目</title>
      <description><![CDATA[示例 <item>幽灵条目</item> 与字面 </item> 文本]]></description>
    </item>`;
  const items = parseRssItems(`<rss><channel>${itemXml}</channel></rss>`);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, '真实条目');
  assert.equal(items[0].xml, itemXml);
});

test('只提取 channel 的直接 item 子元素', () => {
  const items = parseRssItems(`<rss>
  <item><title>channel 外</title></item>
  <channel>
    <wrapper><item><title>嵌套条目</title></item></wrapper>
    <item><title>直接条目</title></item>
  </channel>
</rss>`);

  assert.deepEqual(items.map((item) => item.title), ['直接条目']);
});

test('注释中的 item 字面文本不会生成条目', () => {
  const items = parseRssItems(`<rss><channel>
    <!-- <item><title>注释条目</title></item> -->
    <item><title>真实条目</title></item>
  </channel></rss>`);

  assert.deepEqual(items.map((item) => item.title), ['真实条目']);
});

test('自闭合 item 被提取并保留精确原文', () => {
  const itemXml = '<item data-empty="a > b" />';
  const items = parseRssItems(`<rss><channel>${itemXml}</channel></rss>`);

  assert.deepEqual(items, [{
    title: '',
    link: '',
    pubDate: '',
    xml: itemXml,
  }]);
});

test('格式错误或缺少 channel 的 XML 被拒绝', () => {
  assert.throws(() => parseRssItems('<rss><channel>'), /RSS XML 格式错误/);
  assert.throws(() => parseRssItems('<root />'), /RSS channel 不存在/);
});
