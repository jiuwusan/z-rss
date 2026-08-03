import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_DIRECTORY = fileURLToPath(
  new URL('../../data/', import.meta.url),
);
const writeQueues = new Map();

async function writeJsonAtomically(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function ensureJsonFile(filePath, enqueueWrite) {
  try {
    await access(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await enqueueWrite(async () => {
      try {
        await access(filePath);
      } catch (queuedError) {
        if (queuedError.code !== 'ENOENT') throw queuedError;
        await writeJsonAtomically(filePath, []);
      }
    });
  }
}

async function readJsonArray(filePath, enqueueWrite) {
  await ensureJsonFile(filePath, enqueueWrite);
  const value = JSON.parse(await readFile(filePath, 'utf8'));
  if (!Array.isArray(value)) {
    throw new TypeError(`数据文件必须包含 JSON 数组：${path.basename(filePath)}`);
  }
  return value;
}

function getWriteQueue(dataDirectory) {
  const normalizedDirectory = path.resolve(dataDirectory);

  if (!writeQueues.has(normalizedDirectory)) {
    writeQueues.set(normalizedDirectory, Promise.resolve());
  }

  return (operation) => {
    const queuedOperation = writeQueues.get(normalizedDirectory).then(operation);
    writeQueues.set(normalizedDirectory, queuedOperation.catch(() => {}));
    return queuedOperation;
  };
}

/**
 * 创建 RSS JSON 文件仓储。
 * @param {{ dataDirectory?: string }} options 仓储选项
 */
export function createRssRepository({
  dataDirectory = DEFAULT_DATA_DIRECTORY,
} = {}) {
  const platformsPath = path.join(dataDirectory, 'platforms.json');
  const cachePath = path.join(dataDirectory, 'rss-cache.json');
  const enqueueWrite = getWriteQueue(dataDirectory);

  return {
    listPlatforms: () => readJsonArray(platformsPath, enqueueWrite),
    savePlatforms: (platforms) => enqueueWrite(
      () => writeJsonAtomically(platformsPath, platforms),
    ),
    listItems: () => readJsonArray(cachePath, enqueueWrite),
    saveItems: (items) => enqueueWrite(
      () => writeJsonAtomically(cachePath, items),
    ),
  };
}
