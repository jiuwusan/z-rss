import 'dotenv/config';

/**
 * 将环境变量转换为应用配置。
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env 环境变量
 * @returns {{ port: number, nodeEnv: string }}
 */
export function getConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    nodeEnv: env.NODE_ENV || 'development',
  };
}

const config = getConfig();

export default config;
