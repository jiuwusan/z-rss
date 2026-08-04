const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * 获取条目的展示标题。
 * @param {{ title?: string }} item RSS 条目
 * @returns {string}
 */
export function getDisplayTitle(item) {
  return item?.title?.trim() || '未命名条目';
}

/**
 * 格式化 RSS 时间。
 * @param {string} value 日期文本
 * @returns {string}
 */
export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * 生成刷新结果摘要。
 * @param {{ total?: number, success?: number, failed?: number }} result 刷新结果
 * @returns {string}
 */
export function summarizeRefresh(result) {
  const success = Number(result?.success) || 0;
  const failed = Number(result?.failed) || 0;
  return `已更新 ${success} 个平台，${failed} 个失败`;
}

/**
 * 校验分流规则输入。
 * @param {{ mustInclude?: string, mustExclude?: string }} rule 规则输入
 * @returns {string} 错误消息，为空表示校验通过
 */
export function validateRuleInput(rule) {
  const mustInclude = rule?.mustInclude ?? '';
  const mustExclude = rule?.mustExclude ?? '';
  if (mustInclude.trim() === '') return '请填写必含表达式';
  if (mustInclude.length > 256) return '必含表达式不能超过 256 个字符';
  if (mustExclude.length > 256) return '排除表达式不能超过 256 个字符';
  return '';
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  let payload;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

/**
 * 创建 RSS 后端 API 客户端。
 * @param {typeof fetch} fetchImpl fetch 实现
 */
export function createApiClient(fetchImpl = globalThis.fetch) {
  return {
    listPlatforms: () => requestJson(fetchImpl, '/rss/platforms'),
    listItems: () => requestJson(fetchImpl, '/rss/items'),
    createPlatform: (platform) =>
      requestJson(fetchImpl, '/rss/platforms', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(platform),
      }),
    updatePlatform: (platform, input) =>
      requestJson(fetchImpl, `/rss/platforms/${encodeURIComponent(platform)}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      }),
    deletePlatform: (platform) =>
      requestJson(fetchImpl, `/rss/platforms/${encodeURIComponent(platform)}`, {
        method: 'DELETE',
      }),
    refreshCache: () =>
      requestJson(fetchImpl, '/rss/cache/refresh', { method: 'POST' }),
    listRules: () => requestJson(fetchImpl, '/rss/rules'),
    createRule: (rule) =>
      requestJson(fetchImpl, '/rss/rules', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(rule),
      }),
    updateRule: (id, rule) =>
      requestJson(fetchImpl, `/rss/rules/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(rule),
      }),
    deleteRule: (id) =>
      requestJson(fetchImpl, `/rss/rules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  };
}

/**
 * 管理规则保存期间的 dialog 锁定状态。
 * @param {object} options 状态依赖
 * @returns {object} 规则保存状态控制器
 */
export function createRuleSavingState({
  closeButtons,
  submitButton,
  setButtonBusy,
}) {
  let isRuleSaving = false;
  return {
    get isRuleSaving() {
      return isRuleSaving;
    },
    setSaving(isSaving) {
      isRuleSaving = isSaving;
      for (const button of closeButtons) {
        button.disabled = isSaving;
      }
      setButtonBusy(submitButton, isSaving, '正在保存…');
    },
    handleCancel(event) {
      if (isRuleSaving) event.preventDefault();
    },
  };
}

/**
 * 并行加载管理台数据，并将规则错误限制在规则面板内。
 * @param {object} loaders 数据加载方法
 * @returns {Promise<unknown[]>}
 */
export function loadInitialDashboard({
  loadPlatforms,
  loadItems,
  loadRules,
  handleRulesLoadError,
}) {
  const platformsPromise = loadPlatforms();
  const itemsPromise = loadItems();
  const rulesPromise = loadRules().catch(handleRulesLoadError);
  return Promise.all([platformsPromise, itemsPromise, rulesPromise]);
}

/**
 * 完成规则变更后先确认成功，再将重载失败限制在规则面板内。
 * @param {object} options 规则变更依赖
 * @returns {Promise<unknown>} mutation 返回结果
 */
export async function runRuleMutation({
  mutate,
  handleSuccess,
  loadRules,
  handleRulesLoadError,
}) {
  const result = await mutate();
  handleSuccess(result);
  try {
    await loadRules();
  } catch (error) {
    handleRulesLoadError(error);
  }
  return result;
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function getSafeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function initializeDashboard() {
  const api = createApiClient();
  const state = {
    platforms: [],
    items: [],
    rules: [],
    editingPlatform: null,
    editingRule: null,
    currentXml: '',
  };
  const elements = {
    serviceStatus: document.querySelector('#service-status'),
    refreshButton: document.querySelector('#refresh-button'),
    platformCount: document.querySelector('#platform-count'),
    itemCount: document.querySelector('#item-count'),
    lastRefresh: document.querySelector('#last-refresh'),
    platformList: document.querySelector('#platform-list'),
    itemsList: document.querySelector('#items-list'),
    refreshResults: document.querySelector('#refresh-results'),
    addPlatformButton: document.querySelector('#add-platform-button'),
    ruleCount: document.querySelector('#rule-count'),
    rulesList: document.querySelector('#rules-list'),
    addRuleButton: document.querySelector('#add-rule-button'),
    matchedSubscriptionUrl: document.querySelector(
      '#matched-subscription-url',
    ),
    unmatchedSubscriptionUrl: document.querySelector(
      '#unmatched-subscription-url',
    ),
    matchedSubscriptionLink: document.querySelector(
      '#matched-subscription-link',
    ),
    unmatchedSubscriptionLink: document.querySelector(
      '#unmatched-subscription-link',
    ),
    platformDialog: document.querySelector('#platform-dialog'),
    platformDialogTitle: document.querySelector('#platform-dialog-title'),
    platformForm: document.querySelector('#platform-form'),
    platformInput: document.querySelector('#platform-input'),
    rssInput: document.querySelector('#rss-input'),
    platformFormError: document.querySelector('#platform-form-error'),
    platformSubmitButton: document.querySelector('#platform-submit-button'),
    ruleDialog: document.querySelector('#rule-dialog'),
    ruleDialogTitle: document.querySelector('#rule-dialog-title'),
    ruleForm: document.querySelector('#rule-form'),
    mustIncludeInput: document.querySelector('#must-include-input'),
    mustExcludeInput: document.querySelector('#must-exclude-input'),
    ruleFormError: document.querySelector('#rule-form-error'),
    ruleSubmitButton: document.querySelector('#rule-submit-button'),
    ruleDialogCloseButtons: document.querySelectorAll(
      '[data-rule-dialog-close]',
    ),
    xmlDialog: document.querySelector('#xml-dialog'),
    xmlDialogTitle: document.querySelector('#xml-dialog-title'),
    xmlContent: document.querySelector('#xml-content'),
    copyXmlButton: document.querySelector('#copy-xml-button'),
    toastRegion: document.querySelector('#toast-region'),
  };
  const subscriptionUrls = {
    matched: new URL('/rss/subscriptions/matched', window.location.origin).href,
    unmatched: new URL('/rss/subscriptions/unmatched', window.location.origin)
      .href,
  };
  elements.matchedSubscriptionUrl.value = subscriptionUrls.matched;
  elements.unmatchedSubscriptionUrl.value = subscriptionUrls.unmatched;
  elements.matchedSubscriptionLink.href = subscriptionUrls.matched;
  elements.unmatchedSubscriptionLink.href = subscriptionUrls.unmatched;
  const ruleSavingState = createRuleSavingState({
    closeButtons: elements.ruleDialogCloseButtons,
    submitButton: elements.ruleSubmitButton,
    setButtonBusy,
  });

  function setServiceStatus(isOnline, label) {
    elements.serviceStatus.classList.toggle('is-online', isOnline);
    elements.serviceStatus.classList.toggle('is-offline', !isOnline);
    elements.serviceStatus.lastElementChild.textContent = label;
  }

  function showToast(message, type = 'success') {
    const toast = createElement('div', `toast${type === 'error' ? ' is-error' : ''}`, message);
    elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function setButtonBusy(button, isBusy, busyLabel) {
    if (isBusy) {
      button.dataset.idleLabel = button.textContent.trim();
      button.textContent = busyLabel;
      button.disabled = true;
      button.classList.add('is-busy');
      return;
    }
    button.textContent = button.dataset.idleLabel || button.textContent;
    button.disabled = false;
    button.classList.remove('is-busy');
  }

  function updateStats() {
    elements.platformCount.textContent = String(state.platforms.length);
    elements.itemCount.textContent = String(state.items.length);
  }

  function renderPlatforms() {
    elements.platformList.replaceChildren();
    if (state.platforms.length === 0) {
      elements.platformList.append(
        createElement('div', 'empty-block', '尚未配置订阅平台，点击“新增”开始。'),
      );
      updateStats();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const platform of state.platforms) {
      const card = createElement('article', 'platform-card');
      const header = createElement('div', 'platform-card-header');
      const content = createElement('div');
      const name = createElement('h3', 'platform-name', platform.platform);
      const url = createElement('span', 'platform-url', platform.rss);
      url.title = platform.rss;
      content.append(name, url);

      const actions = createElement('div', 'platform-actions');
      const editButton = createElement('button', 'text-button', '编辑');
      editButton.type = 'button';
      editButton.dataset.action = 'edit';
      editButton.dataset.platform = platform.platform;
      const deleteButton = createElement(
        'button',
        'text-button text-button-danger',
        '删除',
      );
      deleteButton.type = 'button';
      deleteButton.dataset.action = 'delete';
      deleteButton.dataset.platform = platform.platform;
      actions.append(editButton, deleteButton);
      header.append(content, actions);
      card.append(header);
      fragment.append(card);
    }
    elements.platformList.append(fragment);
    updateStats();
  }

  function renderRules() {
    elements.rulesList.replaceChildren();
    elements.ruleCount.textContent = String(state.rules.length);
    if (state.rules.length === 0) {
      elements.rulesList.append(
        createElement(
          'div',
          'empty-block',
          '尚未配置分流规则，所有条目都会进入未匹配订阅。',
        ),
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const rule of state.rules) {
      const card = createElement('article', 'rule-card');
      const patterns = createElement('div', 'rule-patterns');

      const includeRow = createElement('div', 'rule-pattern-row');
      includeRow.append(
        createElement('span', 'rule-pattern-label', '必含'),
        createElement('code', 'rule-pattern', rule.mustInclude),
      );
      const excludeRow = createElement('div', 'rule-pattern-row');
      excludeRow.append(
        createElement('span', 'rule-pattern-label', '排除'),
        createElement(
          'code',
          `rule-pattern${rule.mustExclude ? '' : ' is-empty'}`,
          rule.mustExclude || '未设置',
        ),
      );
      patterns.append(includeRow, excludeRow);

      const actions = createElement('div', 'rule-actions');
      const editButton = createElement('button', 'text-button', '编辑');
      editButton.type = 'button';
      editButton.dataset.action = 'edit-rule';
      editButton.dataset.ruleId = rule.id;
      const deleteButton = createElement(
        'button',
        'text-button text-button-danger',
        '删除',
      );
      deleteButton.type = 'button';
      deleteButton.dataset.action = 'delete-rule';
      deleteButton.dataset.ruleId = rule.id;
      actions.append(editButton, deleteButton);
      card.append(patterns, actions);
      fragment.append(card);
    }
    elements.rulesList.append(fragment);
  }

  function renderItems() {
    elements.itemsList.replaceChildren();
    elements.itemsList.setAttribute('aria-busy', 'false');
    if (state.items.length === 0) {
      elements.itemsList.append(
        createElement(
          'div',
          'empty-block empty-block-large',
          '缓存中暂无条目。配置平台后点击“刷新全部缓存”。',
        ),
      );
      updateStats();
      return;
    }

    const fragment = document.createDocumentFragment();
    state.items.forEach((item, index) => {
      const card = createElement('article', 'item-card');
      const meta = createElement('div', 'item-meta');
      const tag = createElement('span', 'platform-tag', item.platform || 'UNKNOWN');
      const date = createElement('time', 'item-date', formatDate(item.pubDate));
      if (item.pubDate) date.dateTime = item.pubDate;
      meta.append(tag, date);

      const title = createElement('h3', 'item-title', getDisplayTitle(item));
      const actions = createElement('div', 'item-actions');
      const safeLink = getSafeHttpUrl(item.link);
      if (safeLink) {
        const link = createElement('a', 'item-link', '打开资源 ↗');
        link.href = safeLink;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
      }
      const xmlButton = createElement('button', 'text-button', '查看 XML');
      xmlButton.type = 'button';
      xmlButton.dataset.action = 'view-xml';
      xmlButton.dataset.itemIndex = String(index);
      actions.append(xmlButton);
      card.append(meta, title, actions);
      fragment.append(card);
    });
    elements.itemsList.append(fragment);
    updateStats();
  }

  function renderRefreshResults(result) {
    elements.refreshResults.replaceChildren();
    elements.refreshResults.hidden = false;
    elements.refreshResults.append(
      createElement('strong', 'refresh-result-title', summarizeRefresh(result)),
    );
    if (Array.isArray(result.results) && result.results.length > 0) {
      const list = createElement('div', 'refresh-result-list');
      for (const platformResult of result.results) {
        const isFailed = platformResult.status === 'failed';
        const detail = isFailed
          ? `${platformResult.platform}：${platformResult.message || '更新失败'}`
          : `${platformResult.platform}：${platformResult.itemCount ?? 0} 条`;
        list.append(
          createElement(
            'span',
            `refresh-result-chip${isFailed ? ' is-failed' : ''}`,
            detail,
          ),
        );
      }
      elements.refreshResults.append(list);
    }
  }

  async function loadPlatforms() {
    state.platforms = await api.listPlatforms();
    renderPlatforms();
  }

  async function loadItems() {
    state.items = await api.listItems();
    renderItems();
  }

  async function loadRules() {
    state.rules = await api.listRules();
    renderRules();
  }

  function handleRulesLoadError(error) {
    elements.rulesList.replaceChildren(
      createElement('div', 'empty-block', '分流规则加载失败，请稍后重试。'),
    );
    elements.ruleCount.textContent = '—';
    showToast(error.message, 'error');
  }

  function openPlatformDialog(platform = null) {
    state.editingPlatform = platform;
    elements.platformDialogTitle.textContent = platform ? '修改订阅平台' : '新增订阅平台';
    elements.platformInput.value = platform?.platform || '';
    elements.platformInput.disabled = Boolean(platform);
    elements.rssInput.value = platform?.rss || '';
    elements.platformFormError.hidden = true;
    elements.platformFormError.textContent = '';
    elements.platformDialog.showModal();
    window.setTimeout(() => (platform ? elements.rssInput : elements.platformInput).focus());
  }

  async function handlePlatformSubmit(event) {
    event.preventDefault();
    const platform = elements.platformInput.value.trim();
    const rss = elements.rssInput.value.trim();
    elements.platformFormError.hidden = true;
    setButtonBusy(elements.platformSubmitButton, true, '正在保存…');

    try {
      if (state.editingPlatform) {
        await api.updatePlatform(state.editingPlatform.platform, { rss });
      } else {
        await api.createPlatform({ platform, rss });
      }
      await loadPlatforms();
      elements.platformDialog.close();
      showToast(state.editingPlatform ? 'RSS 地址已更新' : '订阅平台已新增');
    } catch (error) {
      elements.platformFormError.textContent = error.message;
      elements.platformFormError.hidden = false;
    } finally {
      setButtonBusy(elements.platformSubmitButton, false);
    }
  }

  function openRuleDialog(rule = null) {
    if (ruleSavingState.isRuleSaving) return;
    state.editingRule = rule;
    elements.ruleDialogTitle.textContent = rule
      ? '修改分流规则'
      : '新增分流规则';
    elements.mustIncludeInput.value = rule?.mustInclude || '';
    elements.mustExcludeInput.value = rule?.mustExclude || '';
    elements.ruleFormError.hidden = true;
    elements.ruleFormError.textContent = '';
    elements.ruleDialog.showModal();
    window.setTimeout(() => elements.mustIncludeInput.focus());
  }

  async function handleRuleSubmit(event) {
    event.preventDefault();
    const rule = {
      mustInclude: elements.mustIncludeInput.value,
      mustExclude: elements.mustExcludeInput.value,
    };
    const validationMessage = validateRuleInput(rule);
    elements.ruleFormError.hidden = validationMessage === '';
    elements.ruleFormError.textContent = validationMessage;
    if (validationMessage) return;

    const editingRule = state.editingRule;
    const isEditing = Boolean(editingRule);
    ruleSavingState.setSaving(true);
    try {
      await runRuleMutation({
        mutate: () => editingRule
          ? api.updateRule(editingRule.id, rule)
          : api.createRule(rule),
        handleSuccess() {
          elements.ruleDialog.close();
          showToast(isEditing ? '分流规则已更新' : '分流规则已新增');
        },
        loadRules,
        handleRulesLoadError,
      });
    } catch (error) {
      elements.ruleFormError.textContent = error.message;
      elements.ruleFormError.hidden = false;
    } finally {
      ruleSavingState.setSaving(false);
    }
  }

  async function handleRuleAction(event) {
    const button = event.target.closest('button[data-rule-id]');
    if (!button) return;
    const rule = state.rules.find((item) => item.id === button.dataset.ruleId);
    if (!rule) return;

    if (button.dataset.action === 'edit-rule') {
      openRuleDialog(rule);
      return;
    }
    if (button.dataset.action !== 'delete-rule') return;
    const isConfirmed = window.confirm(
      `确定删除必含表达式“${rule.mustInclude}”吗？`,
    );
    if (!isConfirmed) return;

    button.disabled = true;
    try {
      await runRuleMutation({
        mutate: () => api.deleteRule(rule.id),
        handleSuccess() {
          showToast('分流规则已删除');
        },
        loadRules,
        handleRulesLoadError,
      });
    } catch (error) {
      button.disabled = false;
      showToast(error.message, 'error');
    }
  }

  async function handlePlatformAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const platform = state.platforms.find(
      (item) => item.platform === button.dataset.platform,
    );
    if (!platform) return;

    if (button.dataset.action === 'edit') {
      openPlatformDialog(platform);
      return;
    }
    if (button.dataset.action !== 'delete') return;
    const isConfirmed = window.confirm(
      `确定删除 ${platform.platform}？对应缓存条目也会被删除。`,
    );
    if (!isConfirmed) return;

    button.disabled = true;
    try {
      await api.deletePlatform(platform.platform);
      await Promise.all([loadPlatforms(), loadItems()]);
      showToast(`${platform.platform} 已删除`);
    } catch (error) {
      button.disabled = false;
      showToast(error.message, 'error');
    }
  }

  async function handleRefresh() {
    setButtonBusy(elements.refreshButton, true, '正在刷新…');
    elements.refreshResults.hidden = true;
    try {
      const result = await api.refreshCache();
      renderRefreshResults(result);
      elements.lastRefresh.textContent = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      await loadItems();
      showToast(summarizeRefresh(result), result.failed > 0 ? 'error' : 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setButtonBusy(elements.refreshButton, false);
    }
  }

  function handleItemAction(event) {
    const button = event.target.closest('button[data-action="view-xml"]');
    if (!button) return;
    const item = state.items[Number(button.dataset.itemIndex)];
    if (!item) return;
    state.currentXml = item.xml || '';
    elements.xmlDialogTitle.textContent = `${item.platform || 'UNKNOWN'} · 原始 XML`;
    elements.xmlContent.textContent = state.currentXml;
    elements.xmlDialog.showModal();
  }

  async function copyXml() {
    try {
      await navigator.clipboard.writeText(state.currentXml);
      showToast('XML 已复制');
    } catch {
      showToast('浏览器未允许复制，请手动选择文本', 'error');
    }
  }

  async function copySubscription(event) {
    const subscriptionUrl =
      subscriptionUrls[event.currentTarget.dataset.copySubscription];
    try {
      await navigator.clipboard.writeText(subscriptionUrl);
      showToast('订阅链接已复制');
    } catch {
      showToast('浏览器未允许复制，请手动选择订阅链接', 'error');
    }
  }

  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => {
      document.querySelector(`#${button.dataset.closeDialog}`)?.close();
    });
  }
  elements.addPlatformButton.addEventListener('click', () => openPlatformDialog());
  elements.addRuleButton.addEventListener('click', () => openRuleDialog());
  elements.platformForm.addEventListener('submit', handlePlatformSubmit);
  elements.ruleForm.addEventListener('submit', handleRuleSubmit);
  elements.ruleDialog.addEventListener('cancel', ruleSavingState.handleCancel);
  elements.platformList.addEventListener('click', handlePlatformAction);
  elements.rulesList.addEventListener('click', handleRuleAction);
  elements.refreshButton.addEventListener('click', handleRefresh);
  elements.itemsList.addEventListener('click', handleItemAction);
  elements.copyXmlButton.addEventListener('click', copyXml);
  for (const button of document.querySelectorAll('[data-copy-subscription]')) {
    button.addEventListener('click', copySubscription);
  }

  loadInitialDashboard({
    loadPlatforms,
    loadItems,
    loadRules,
    handleRulesLoadError,
  })
    .then(() => setServiceStatus(true, '服务在线'))
    .catch((error) => {
      setServiceStatus(false, '连接失败');
      elements.platformList.replaceChildren(
        createElement('div', 'empty-block', '平台数据加载失败，请稍后重试。'),
      );
      elements.itemsList.replaceChildren(
        createElement('div', 'empty-block empty-block-large', '缓存数据加载失败，请稍后重试。'),
      );
      elements.itemsList.setAttribute('aria-busy', 'false');
      elements.rulesList.replaceChildren(
        createElement('div', 'empty-block', '分流规则加载失败，请稍后重试。'),
      );
      elements.ruleCount.textContent = '—';
      showToast(error.message, 'error');
    });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initializeDashboard);
}
