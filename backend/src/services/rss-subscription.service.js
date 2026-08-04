import { randomUUID } from 'node:crypto';
import { createRssRepository } from '../repositories/rss.repository.js';
import { createHttpError } from '../utils/http-error.util.js';
import { sortRssItems } from '../utils/rss-item.util.js';

const MAX_RULES = 100;
const MAX_PATTERN_LENGTH = 256;
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
  templatePath,
} = {}) {
  void templatePath;

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
    return rules.map(validateStoredRule);
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

  return {
    listRules,
    createRule,
    updateRule,
    deleteRule,
  };
}
