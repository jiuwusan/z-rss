import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseRssItems } from '../parsers/rss.parser.js';
import { createRssRepository } from '../repositories/rss.repository.js';
import { createHttpError } from '../utils/http-error.util.js';
import { sortRssItems } from '../utils/rss-item.util.js';

const MAX_RULES = 100;
const MAX_PATTERN_LENGTH = 256;
const DEFAULT_TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/subscription.xml', import.meta.url),
);
const ITEM_PLACEHOLDER = '<!-- 在这里插入 item 标签内容 -->';
let writeQueue = Promise.resolve();

function validatePattern(value, fieldName, { required }) {
  if (typeof value !== 'string') {
    throw createHttpError(400, `${fieldName} 必须是字符串`);
  }
  if (required && value.trim() === '') {
    throw createHttpError(400, `${fieldName} 不能为空`);
  }
  if (value.length > MAX_PATTERN_LENGTH) {
    throw createHttpError(400, `${fieldName} 最长 256 个字符`);
  }
  if (value === '') return '';
  try {
    new RegExp(value, 'i');
  } catch {
    throw createHttpError(400, `${fieldName} 正则无效`);
  }
  return value;
}

function validateRuleInput(input = {}, { allowMissingMustExclude = true } = {}) {
  const mustExclude = allowMissingMustExclude && input?.mustExclude === undefined
    ? ''
    : input?.mustExclude;
  return {
    mustInclude: validatePattern(input?.mustInclude, 'mustInclude', { required: true }),
    mustExclude: validatePattern(mustExclude, 'mustExclude', { required: false }),
  };
}

function validateStoredRule(rule) {
  try {
    if (typeof rule?.id !== 'string' || rule.id.trim() === '') {
      throw new TypeError('id 必须是非空字符串');
    }
    const validatedRule = validateRuleInput(rule, { allowMissingMustExclude: false });
    return { id: rule.id, ...validatedRule };
  } catch {
    throw new Error('持久化 RSS 分流规则无效');
  }
}

function validateStoredRules(rules) {
  const validatedRules = rules.map(validateStoredRule);
  const ruleIds = new Set(validatedRules.map((rule) => rule.id));
  if (validatedRules.length > MAX_RULES || ruleIds.size !== validatedRules.length) {
    throw new Error('持久化 RSS 分流规则集合无效');
  }
  return validatedRules;
}

function validateItemXml(itemXml) {
  if (typeof itemXml !== 'string') {
    throw new Error('RSS 条目原始 XML 无效');
  }
  try {
    const parsedItems = parseRssItems(
      `<rss><channel>${itemXml}</channel></rss>`,
    );
    if (parsedItems.length !== 1 || parsedItems[0].xml !== itemXml) {
      throw new Error('RSS 条目原始 XML 无效');
    }
  } catch {
    throw new Error('RSS 条目原始 XML 无效');
  }
  return itemXml;
}

/**
 * 将 RSS 条目按规则分为已匹配和未匹配两组。
 * @param {object[]} items RSS 条目
 * @param {object[]} rules 分流规则
 * @returns {{ matched: object[], unmatched: object[] }} 分流结果
 */
export function partitionItems(items, rules) {
  const patterns = rules.map((rule) => ({
    include: new RegExp(rule.mustInclude, 'i'),
    exclude: rule.mustExclude ? new RegExp(rule.mustExclude, 'i') : null,
  }));
  const matched = [];
  const unmatched = [];
  for (const item of sortRssItems(items)) {
    const title = typeof item.title === 'string' ? item.title : '';
    const isMatched = title !== '' && patterns.some(({ include, exclude }) =>
      include.test(title) && (!exclude || !exclude.test(title))
    );
    (isMatched ? matched : unmatched).push(item);
  }
  return { matched, unmatched };
}

/**
 * 创建 RSS 分流规则业务服务。
 * @param {object} options 服务依赖
 * @returns {object} RSS 分流规则业务方法集合
 */
export function createRssSubscriptionService({
  repository = createRssRepository(),
  createId = randomUUID,
  templatePath = DEFAULT_TEMPLATE_PATH,
} = {}) {
  async function withWriteLock(operation) {
    const previousWrite = writeQueue;
    let releaseWrite;
    writeQueue = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;
    try {
      return await operation();
    } finally {
      releaseWrite();
    }
  }

  async function listRules() {
    const rules = await repository.listRules();
    return validateStoredRules(rules);
  }

  async function createRule(input = {}) {
    return withWriteLock(async () => {
      const rule = validateRuleInput(input);
      const rules = await listRules();
      if (rules.length >= MAX_RULES) {
        throw createHttpError(400, '规则最多 100 条');
      }
      const createdRule = { id: createId(), ...rule };
      await repository.saveRules([...rules, createdRule]);
      return createdRule;
    });
  }

  async function updateRule(id, input = {}) {
    return withWriteLock(async () => {
      const rule = validateRuleInput(input);
      const rules = await listRules();
      const ruleIndex = rules.findIndex((item) => item.id === id);
      if (ruleIndex === -1) throw createHttpError(404, '规则不存在');
      const updatedRule = { id: rules[ruleIndex].id, ...rule };
      rules[ruleIndex] = updatedRule;
      await repository.saveRules(rules);
      return updatedRule;
    });
  }

  async function deleteRule(id) {
    return withWriteLock(async () => {
      const rules = await listRules();
      const ruleIndex = rules.findIndex((item) => item.id === id);
      if (ruleIndex === -1) throw createHttpError(404, '规则不存在');
      const [deletedRule] = rules.splice(ruleIndex, 1);
      await repository.saveRules(rules);
      return deletedRule;
    });
  }

  async function buildSubscription(kind) {
    if (!['matched', 'unmatched'].includes(kind)) {
      throw createHttpError(404, '订阅类型不存在');
    }
    const [items, rules, template] = await Promise.all([
      repository.listItems(),
      listRules(),
      readFile(templatePath, 'utf8'),
    ]);
    if (template.split(ITEM_PLACEHOLDER).length !== 2) {
      throw new Error('RSS 订阅母版占位符无效');
    }
    const partitioned = partitionItems(items, rules);
    const itemXml = partitioned[kind]
      .map((item) => validateItemXml(item.xml))
      .join('\n');
    return template.replace(ITEM_PLACEHOLDER, () => itemXml);
  }

  return {
    listRules,
    createRule,
    updateRule,
    deleteRule,
    buildSubscription,
  };
}
