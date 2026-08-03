import { XMLParser, XMLValidator } from 'fast-xml-parser';

const ITEM_PATTERN = /<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/giu;
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

/**
 * 将 XML 字段规范化为字符串。
 * @param {unknown} value XML 解析结果
 * @returns {string}
 */
function normalizeText(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

/**
 * 提取 RSS 中的 item 数据并保留原始 XML。
 * @param {string} rssXml RSS XML 文本
 * @returns {Array<{ title: string, link: string, pubDate: string, xml: string }>}
 */
export function parseRssItems(rssXml) {
  if (typeof rssXml !== 'string') {
    throw new Error('RSS XML 格式错误');
  }

  const validationResult = XMLValidator.validate(rssXml);
  if (validationResult !== true) {
    throw new Error('RSS XML 格式错误');
  }

  const rssDocument = xmlParser.parse(rssXml);
  if (!rssDocument?.rss || !Object.hasOwn(rssDocument.rss, 'channel')) {
    throw new Error('RSS channel 不存在');
  }

  const rawItems = rssXml.match(ITEM_PATTERN) ?? [];
  return rawItems.map((itemXml) => {
    const item = xmlParser.parse(itemXml).item ?? {};
    return {
      title: normalizeText(item.title),
      link: normalizeText(item.link),
      pubDate: normalizeText(item.pubDate),
      xml: itemXml,
    };
  });
}
