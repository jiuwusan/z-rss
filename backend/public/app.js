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
  };
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
    editingPlatform: null,
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
    platformDialog: document.querySelector('#platform-dialog'),
    platformDialogTitle: document.querySelector('#platform-dialog-title'),
    platformForm: document.querySelector('#platform-form'),
    platformInput: document.querySelector('#platform-input'),
    rssInput: document.querySelector('#rss-input'),
    platformFormError: document.querySelector('#platform-form-error'),
    platformSubmitButton: document.querySelector('#platform-submit-button'),
    xmlDialog: document.querySelector('#xml-dialog'),
    xmlDialogTitle: document.querySelector('#xml-dialog-title'),
    xmlContent: document.querySelector('#xml-content'),
    copyXmlButton: document.querySelector('#copy-xml-button'),
    toastRegion: document.querySelector('#toast-region'),
  };

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

  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => {
      document.querySelector(`#${button.dataset.closeDialog}`)?.close();
    });
  }
  elements.addPlatformButton.addEventListener('click', () => openPlatformDialog());
  elements.platformForm.addEventListener('submit', handlePlatformSubmit);
  elements.platformList.addEventListener('click', handlePlatformAction);
  elements.refreshButton.addEventListener('click', handleRefresh);
  elements.itemsList.addEventListener('click', handleItemAction);
  elements.copyXmlButton.addEventListener('click', copyXml);

  Promise.all([loadPlatforms(), loadItems()])
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
      showToast(error.message, 'error');
    });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initializeDashboard);
}
