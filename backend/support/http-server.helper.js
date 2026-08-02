import { once } from 'node:events';

/**
 * 在本机随机端口启动测试服务。
 * @param {import('koa')} app Koa 应用
 * @returns {Promise<import('node:http').Server>}
 */
export async function startTestServer(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

/**
 * 关闭测试服务及其连接。
 * @param {import('node:http').Server} server HTTP 服务
 * @returns {Promise<void>}
 */
export async function stopTestServer(server) {
  const closePromise = new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  server.closeAllConnections();
  await closePromise;
}
