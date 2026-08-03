import { XMLParser, XMLValidator } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

function findTagEnd(xml, tagStart) {
  let quote = '';
  for (let index = tagStart + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return xml.length - 1;
}

function findDeclarationEnd(xml, declarationStart) {
  let quote = '';
  let bracketDepth = 0;
  for (let index = declarationStart + 2; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth -= 1;
    } else if (character === '>' && bracketDepth === 0) {
      return index;
    }
  }
  return xml.length - 1;
}

function readTag(xml, tagStart, tagEnd) {
  let index = tagStart + 1;
  const isClosing = xml[index] === '/';
  if (isClosing) index += 1;
  while (/\s/u.test(xml[index])) index += 1;
  const nameStart = index;
  while (index < tagEnd && !/[\s/>]/u.test(xml[index])) index += 1;

  let contentEnd = tagEnd - 1;
  while (contentEnd > tagStart && /\s/u.test(xml[contentEnd])) contentEnd -= 1;
  return {
    name: xml.slice(nameStart, index),
    isClosing,
    isSelfClosing: !isClosing && xml[contentEnd] === '/',
  };
}

/**
 * 按 XML 词法结构定位 channel 的直接 item 子元素，避免内容字面量被当成标签。
 * @param {string} rssXml RSS XML 文本
 * @returns {string[]}
 */
function extractRawItems(rssXml) {
  const rawItems = [];
  const elementStack = [];

  for (let index = 0; index < rssXml.length;) {
    const tagStart = rssXml.indexOf('<', index);
    if (tagStart === -1) break;

    if (rssXml.startsWith('<![CDATA[', tagStart)) {
      const cdataEnd = rssXml.indexOf(']]>', tagStart + 9);
      index = cdataEnd + 3;
      continue;
    }
    if (rssXml.startsWith('<!--', tagStart)) {
      const commentEnd = rssXml.indexOf('-->', tagStart + 4);
      index = commentEnd + 3;
      continue;
    }
    if (rssXml.startsWith('<?', tagStart)) {
      const instructionEnd = rssXml.indexOf('?>', tagStart + 2);
      index = instructionEnd + 2;
      continue;
    }
    if (rssXml.startsWith('<!', tagStart)) {
      index = findDeclarationEnd(rssXml, tagStart) + 1;
      continue;
    }

    const tagEnd = findTagEnd(rssXml, tagStart);
    const tag = readTag(rssXml, tagStart, tagEnd);
    if (tag.isClosing) {
      const element = elementStack.pop();
      if (element?.itemStart !== undefined) {
        rawItems.push(rssXml.slice(element.itemStart, tagEnd + 1));
      }
      index = tagEnd + 1;
      continue;
    }

    const parent = elementStack.at(-1);
    const isRssChannel = tag.name === 'channel'
      && elementStack.length === 1
      && parent?.name === 'rss';
    const isDirectItem = tag.name === 'item' && parent?.isRssChannel === true;

    if (tag.isSelfClosing) {
      if (isDirectItem) rawItems.push(rssXml.slice(tagStart, tagEnd + 1));
    } else {
      elementStack.push({
        name: tag.name,
        isRssChannel,
        ...(isDirectItem ? { itemStart: tagStart } : {}),
      });
    }
    index = tagEnd + 1;
  }

  return rawItems;
}

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

  const rawItems = extractRawItems(rssXml);
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
