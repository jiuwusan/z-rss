/**
 * 获取当前服务健康状态。
 * @returns {{ status: string, timestamp: string, uptime: number }}
 */
export function getHealthStatus() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
}
