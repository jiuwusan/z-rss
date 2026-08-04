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

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('js-ready');
}
