/**
 * 按发布时间倒序排列 RSS 条目，并将无效日期稳定置于末尾。
 * @param {object[]} items RSS 条目
 * @returns {object[]} 已排序的 RSS 条目副本
 */
export function sortRssItems(items) {
  return [...items].sort((left, right) => {
    const leftTimestamp = Date.parse(left.pubDate);
    const rightTimestamp = Date.parse(right.pubDate);
    const isLeftValid = Number.isFinite(leftTimestamp);
    const isRightValid = Number.isFinite(rightTimestamp);
    if (isLeftValid && isRightValid) return rightTimestamp - leftTimestamp;
    if (isLeftValid) return -1;
    if (isRightValid) return 1;
    return 0;
  });
}
