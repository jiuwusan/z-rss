# qBittorrent RSS 订阅分流实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 RSS 本地缓存增加可配置的 title 正则分流规则，并向 qBittorrent 提供命中与非命中两个 RSS XML 订阅地址。

**Architecture:** 在现有 JSON repository 中增加规则文件读写，使用独立 Subscription Service 负责规则 CRUD、忽略大小写的正则匹配、排序和母版 XML 生成。规则管理接口继续返回统一 JSON，订阅接口按请求读取本地缓存并直接返回 `text/xml; charset=utf-8`；现有原生前端增加规则管理和订阅链接区域。

**Tech Stack:** Node.js 22、Koa 3、ES Modules、HTML5、CSS3、原生 JavaScript、Node.js `node:test`、Supertest。

## Global Constraints

- 设计依据：`docs/2026-08-04_qBittorrent订阅分流设计.md`。
- 规则作用于全部平台缓存，单条规则为“必含匹配且必不含不匹配”，多条规则使用 OR。
- 正则统一使用 `i` 标志，配置只保存表达式内容，不使用 `/.../i` 包装。
- `mustInclude` 必填，`mustExclude` 可空；单个正则最长 256 字符，规则最多 100 条。
- 无规则时命中订阅为空，非命中订阅包含全部缓存条目。
- 订阅路径固定为 `/rss/subscriptions/matched` 与 `/rss/subscriptions/unmatched`，不带 `.xml`。
- 成功订阅响应使用 `text/xml; charset=utf-8` 和 `Cache-Control: no-store`，不使用 JSON 包装。
- 订阅请求只读取本地缓存，不访问外部 RSS，不修改缓存。
- 使用需求母版并精确保留原始 `item.xml`，不重新序列化 item。
- 代码注释和文档使用中文；不引入前端框架、构建工具或新运行依赖。
- 接口无鉴权，只允许部署在可信网络，不自动 Push。

---

### Task 1: 规则 JSON 持久化

**Files:**
- Modify: `backend/src/repositories/rss.repository.js`
- Modify: `backend/tests/rss.repository.test.js`
- Create: `backend/data/rss-rules.json`

**Interfaces:**
- Produces: `repository.listRules(): Promise<Rule[]>`
- Produces: `repository.saveRules(rules: Rule[]): Promise<void>`
- `Rule`: `{ id: string, mustInclude: string, mustExclude: string }`

- [ ] **Step 1: 编写规则文件初始化、读写和损坏 JSON 的失败测试**

在 `backend/tests/rss.repository.test.js` 的首个测试中增加：

```js
assert.deepEqual(await repository.listRules(), []);
await repository.saveRules([
  { id: 'rule-1', mustInclude: '2160p', mustExclude: 'DV' },
]);
assert.equal((await repository.listRules())[0].id, 'rule-1');
assert.deepEqual(
  (await readdir(dataDirectory)).sort(),
  ['platforms.json', 'rss-cache.json', 'rss-rules.json'],
);
```

在损坏 JSON 测试中增加独立用例：

```js
test('损坏的规则 JSON 会抛错且不会被静默覆盖', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'z-rss-repository-'));
  const repository = createRssRepository({ dataDirectory });
  try {
    await writeFile(path.join(dataDirectory, 'rss-rules.json'), '{bad', 'utf8');
    await assert.rejects(() => repository.listRules(), SyntaxError);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```bash
cd backend
node --test --experimental-test-isolation=none tests/rss.repository.test.js
```

Expected: FAIL，`repository.listRules is not a function`。

- [ ] **Step 3: 实现规则文件读写**

在 `createRssRepository` 中增加路径和方法：

```js
const rulesPath = path.join(dataDirectory, 'rss-rules.json');

return {
  listPlatforms: () => readJsonArray(platformsPath, enqueueWrite),
  savePlatforms: (platforms) => enqueueWrite(
    () => writeJsonAtomically(platformsPath, platforms),
  ),
  listItems: () => readJsonArray(cachePath, enqueueWrite),
  saveItems: (items) => enqueueWrite(
    () => writeJsonAtomically(cachePath, items),
  ),
  listRules: () => readJsonArray(rulesPath, enqueueWrite),
  saveRules: (rules) => enqueueWrite(
    () => writeJsonAtomically(rulesPath, rules),
  ),
};
```

创建 `backend/data/rss-rules.json`：

```json
[]
```

- [ ] **Step 4: 运行 repository 测试**

Run: `cd backend && node --test --experimental-test-isolation=none tests/rss.repository.test.js`

Expected: repository 全部测试 PASS，临时目录仅包含三个 JSON 数据文件。

- [ ] **Step 5: 提交规则持久化**

```bash
git add backend/src/repositories/rss.repository.js backend/tests/rss.repository.test.js backend/data/rss-rules.json
git diff --cached --check
git commit -m "feat: 添加 RSS 分流规则持久化"
```

---

### Task 2: 规则 CRUD、正则匹配与统一排序

**Files:**
- Create: `backend/src/services/rss-subscription.service.js`
- Create: `backend/src/utils/rss-item.util.js`
- Create: `backend/tests/rss-subscription.service.test.js`
- Modify: `backend/src/services/rss.service.js`
- Modify: `backend/tests/rss.service.test.js`

**Interfaces:**
- Consumes: Task 1 的 `listRules`、`saveRules`、`listItems`
- Produces: `createRssSubscriptionService({ repository, createId?, templatePath? })`
- Produces: `listRules()`、`createRule(input)`、`updateRule(id, input)`、`deleteRule(id)`
- Produces: `partitionItems(items, rules): { matched: Item[], unmatched: Item[] }`
- Produces: `sortRssItems(items): Item[]`

- [ ] **Step 1: 编写规则 CRUD 和校验失败测试**

创建 `backend/tests/rss-subscription.service.test.js`，使用临时目录 fixture，并覆盖：

```js
const service = createRssSubscriptionService({
  repository,
  createId: () => 'rule-1',
});
const created = await service.createRule({
  mustInclude: '2160p|4K',
  mustExclude: 'DV',
});
assert.deepEqual(created, {
  id: 'rule-1',
  mustInclude: '2160p|4K',
  mustExclude: 'DV',
});
assert.deepEqual(await service.listRules(), [created]);
assert.equal(
  (await service.updateRule('rule-1', {
    mustInclude: '1080p',
    mustExclude: '',
  })).mustInclude,
  '1080p',
);
assert.equal((await service.deleteRule('rule-1')).id, 'rule-1');
```

增加断言覆盖：空必含、非字符串字段、无效必含正则、无效必不含正则、257 字符表达式、超过 100 条、修改/删除不存在 ID；分别断言 `error.status === 400` 或 `404`。

- [ ] **Step 2: 编写匹配和排序失败测试**

测试数据至少包含：`2160P`、`2160p DV`、`1080p`、空 title、有效日期和无效日期。断言：

```js
const result = partitionItems(items, [
  { id: '1', mustInclude: '2160p', mustExclude: 'dv' },
  { id: '2', mustInclude: '1080p.*WEB-DL', mustExclude: '' },
]);
assert.deepEqual(result.matched.map((item) => item.title), [
  '2160P WEB-DL',
  '1080p WEB-DL',
]);
assert.deepEqual(result.unmatched.map((item) => item.title), [
  '2160p DV',
  '',
]);
assert.deepEqual(partitionItems(items, []).matched, []);
assert.equal(partitionItems(items, []).unmatched.length, items.length);
```

同时为 `sortRssItems` 断言有效日期倒序、无效日期末尾和稳定顺序；保留现有 `rss.service.test.js` 的聚合排序断言作为回归。

- [ ] **Step 3: 运行新测试并确认失败**

Run:

```bash
cd backend
node --test --experimental-test-isolation=none tests/rss-subscription.service.test.js
```

Expected: FAIL，订阅 Service 和排序工具模块不存在。

- [ ] **Step 4: 实现共享排序工具和规则匹配纯函数**

创建 `backend/src/utils/rss-item.util.js`：

```js
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
```

在 `rss-subscription.service.js` 中导出：

```js
export function partitionItems(items, rules) {
  const patterns = rules.map((rule) => ({
    include: new RegExp(rule.mustInclude, 'i'),
    exclude: rule.mustExclude ? new RegExp(rule.mustExclude, 'i') : null,
  }));
  const matched = [];
  const unmatched = [];
  for (const item of sortRssItems(items)) {
    const title = typeof item.title === 'string' ? item.title : '';
    const isMatched = patterns.some(({ include, exclude }) =>
      include.test(title) && (!exclude || !exclude.test(title))
    );
    (isMatched ? matched : unmatched).push(item);
  }
  return { matched, unmatched };
}
```

正则不使用 `g` 标志，因此连续调用 `test` 不产生 `lastIndex` 状态问题。

- [ ] **Step 5: 实现规则 CRUD 和服务级写锁**

使用模块级 Promise 队列串行化规则的读改写，保持与现有 `rss.service.js` 写锁风格一致。校验函数必须：

```js
const MAX_RULES = 100;
const MAX_PATTERN_LENGTH = 256;

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
```

`createRule` 在写锁内检查 100 条上限，生成 ID 后保存；`updateRule` 和 `deleteRule` 在写锁内查找 ID，不存在时抛出 404。`listRules` 读取后逐条执行同一校验，持久化数据无效时抛出普通错误，使统一中间件返回安全 500。

- [ ] **Step 6: 让现有聚合列表复用统一排序**

在 `rss.service.js` 导入 `sortRssItems`，将 `listItems` 的内联排序替换为：

```js
return sortRssItems(publicItems);
```

- [ ] **Step 7: 运行 Service 测试和全量测试**

Run:

```bash
cd backend
node --test --experimental-test-isolation=none tests/rss-subscription.service.test.js tests/rss.service.test.js
npm test
```

Expected: 新增和现有测试全部 PASS，现有聚合顺序不变。

- [ ] **Step 8: 提交规则业务与匹配逻辑**

```bash
git add backend/src/services/rss-subscription.service.js backend/src/utils/rss-item.util.js backend/src/services/rss.service.js backend/tests/rss-subscription.service.test.js backend/tests/rss.service.test.js
git diff --cached --check
git commit -m "feat: 添加 RSS 正则分流规则服务"
```

---

### Task 3: RSS 母版生成与 HTTP 接口

**Files:**
- Create: `backend/templates/subscription.xml`
- Create: `backend/src/controllers/rss-subscription.controller.js`
- Create: `backend/tests/rss-subscription.api.test.js`
- Modify: `backend/src/services/rss-subscription.service.js`
- Modify: `backend/tests/rss-subscription.service.test.js`
- Modify: `backend/src/routes/rss.route.js`
- Modify: `backend/src/routes/index.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: Task 2 的 `partitionItems`、`sortRssItems` 和规则 Service
- Produces: `subscriptionService.buildSubscription(kind): Promise<string>`，`kind` 仅允许 `matched` 或 `unmatched`
- Produces: `GET /rss/subscriptions/matched`
- Produces: `GET /rss/subscriptions/unmatched`

- [ ] **Step 1: 编写母版生成失败测试**

复制需求母版内容作为测试 fixture，在 `rss-subscription.service.test.js` 中保存两个带 enclosure/guid 的原始 item，并断言：

```js
const xml = await service.buildSubscription('matched');
assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
assert.match(xml, /<enclosure url="https:\/\/example\.com\/download\?passkey=secret"/);
assert.match(xml, /<guid isPermaLink="false">guid-1<\/guid>/);
assert.doesNotMatch(xml, /在这里插入 item 标签内容/);
assert.equal(xml.indexOf('较晚'), xml.lastIndexOf('较晚'));
```

增加空命中订阅仍包含 `<rss>`、`<channel>` 且不包含 `<item>` 的断言；增加模板缺少占位注释时 `assert.rejects`。

- [ ] **Step 2: 编写规则 CRUD 和订阅 HTTP 失败测试**

创建 `backend/tests/rss-subscription.api.test.js`。fixture 使用同一个 repository 创建 `rssService` 和 `subscriptionService`，再调用：

```js
createApp({ rssService, subscriptionService })
```

覆盖：

```js
const created = await request(server)
  .post('/rss/rules')
  .send({ mustInclude: '2160p', mustExclude: 'DV' });
assert.equal(created.status, 201);

const matched = await request(server).get('/rss/subscriptions/matched');
assert.equal(matched.status, 200);
assert.match(matched.headers['content-type'], /^text\/xml; charset=utf-8$/);
assert.equal(matched.headers['cache-control'], 'no-store');
assert.match(matched.text, /2160P WEB-DL/);
assert.doesNotMatch(matched.text, /2160p DV/);

const unmatched = await request(server).get('/rss/subscriptions/unmatched');
assert.match(unmatched.text, /2160p DV/);
```

同时覆盖规则 GET/PUT/DELETE、无效正则 400、不存在 ID 404、无 `.xml` 路径 404，以及订阅请求期间注入的外部 `fetch` 调用次数保持 0。

- [ ] **Step 3: 运行聚焦测试并确认失败**

Run:

```bash
cd backend
node --test --experimental-test-isolation=none tests/rss-subscription.service.test.js tests/rss-subscription.api.test.js
```

Expected: FAIL，`buildSubscription`、注入参数和 HTTP 路由不存在。

- [ ] **Step 4: 添加运行母版并实现 XML 生成**

创建 `backend/templates/subscription.xml`，内容复制自 `prds/rss 订阅示例/template.xml`，保留唯一占位注释：

```xml
<!-- 在这里插入 item 标签内容 -->
```

在 Subscription Service 中设置默认路径：

```js
const DEFAULT_TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/subscription.xml', import.meta.url),
);
const ITEM_PLACEHOLDER = '<!-- 在这里插入 item 标签内容 -->';
```

实现：

```js
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
  const itemXml = partitioned[kind].map((item) => item.xml).join('\n');
  return template.replace(ITEM_PLACEHOLDER, itemXml);
}
```

- [ ] **Step 5: 实现 Controller、路由和依赖注入**

Controller 的规则方法使用 `createSuccessResponse`；订阅方法直接设置：

```js
ctx.set('Content-Type', 'text/xml; charset=utf-8');
ctx.set('Cache-Control', 'no-store');
ctx.body = await subscriptionService.buildSubscription('matched');
```

非命中方法传入 `unmatched`。路由增加：

```js
router.get('/rss/rules', controller.listRules);
router.post('/rss/rules', controller.createRule);
router.put('/rss/rules/:id', controller.updateRule);
router.delete('/rss/rules/:id', controller.deleteRule);
router.get('/rss/subscriptions/matched', controller.getMatchedSubscription);
router.get('/rss/subscriptions/unmatched', controller.getUnmatchedSubscription);
```

`createRouter` 和 `createApp` 接受可选的 `subscriptionService`。默认组装时创建一个 repository，并让 RSS Service 与 Subscription Service 共享该实例；测试可分别注入两个 Service。

- [ ] **Step 6: 运行接口测试和全量测试**

Run:

```bash
cd backend
node --test --experimental-test-isolation=none tests/rss-subscription.service.test.js tests/rss-subscription.api.test.js
npm test
```

Expected: 新订阅接口及全部回归测试 PASS。

- [ ] **Step 7: 提交 XML 和 HTTP 接口**

```bash
git add backend/templates/subscription.xml backend/src/controllers/rss-subscription.controller.js backend/src/services/rss-subscription.service.js backend/src/routes/rss.route.js backend/src/routes/index.js backend/src/app.js backend/tests/rss-subscription.service.test.js backend/tests/rss-subscription.api.test.js
git diff --cached --check
git commit -m "feat: 添加 qBittorrent RSS 分流订阅接口"
```

---

### Task 4: 前端规则管理与订阅链接

**Files:**
- Modify: `backend/public/index.html`
- Modify: `backend/public/styles.css`
- Modify: `backend/public/app.js`
- Modify: `backend/tests/frontend.test.js`

**Interfaces:**
- Consumes: Task 3 的规则 CRUD 和两个固定订阅路径
- Produces: 管理台规则列表、规则 dialog、订阅 URL 复制与打开交互

- [ ] **Step 1: 编写静态结构和 API client 失败测试**

在 `frontend.test.js` 的页面测试中增加：

```js
assert.match(page.text, /id="rules-panel"/);
assert.match(page.text, /id="rule-dialog"/);
assert.match(page.text, /id="matched-subscription-url"/);
assert.match(page.text, /id="unmatched-subscription-url"/);
```

扩展 API client 测试，依次调用：

```js
await api.listRules();
await api.createRule({ mustInclude: '2160p', mustExclude: 'DV' });
await api.updateRule('rule 1', { mustInclude: '1080p', mustExclude: '' });
await api.deleteRule('rule 1');
```

并断言路径和方法分别为 GET/POST `/rss/rules`、PUT/DELETE `/rss/rules/rule%201`。

- [ ] **Step 2: 运行前端测试并确认失败**

Run: `cd backend && node --test --experimental-test-isolation=none tests/frontend.test.js`

Expected: FAIL，页面元素和 API client 方法不存在。

- [ ] **Step 3: 添加规则面板和 dialog HTML**

在现有 workspace 下增加全宽 `rules-panel`，包含：

- 规则数量和新增按钮。
- `#rules-list` 加载、空状态和规则卡片容器。
- `#matched-subscription-url`、`#unmatched-subscription-url` 只读 URL。
- `data-copy-subscription` 复制按钮和 `target="_blank"` 打开链接。
- `#rule-dialog` 表单，字段为 `#must-include-input` 与 `#must-exclude-input`。
- 提示文本“默认忽略大小写，不需要填写 /.../i”。

- [ ] **Step 4: 实现 API client 和页面状态**

在 `createApiClient` 中增加：

```js
listRules: () => requestJson(fetchImpl, '/rss/rules'),
createRule: (rule) => requestJson(fetchImpl, '/rss/rules', {
  method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(rule),
}),
updateRule: (id, rule) => requestJson(
  fetchImpl,
  `/rss/rules/${encodeURIComponent(id)}`,
  { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(rule) },
),
deleteRule: (id) => requestJson(
  fetchImpl,
  `/rss/rules/${encodeURIComponent(id)}`,
  { method: 'DELETE' },
),
```

页面状态增加 `rules` 和 `editingRule`。初始化时使用：

```js
Promise.all([loadPlatforms(), loadItems(), loadRules()])
```

订阅 URL 使用当前 origin 构造：

```js
new URL('/rss/subscriptions/matched', window.location.origin).href
new URL('/rss/subscriptions/unmatched', window.location.origin).href
```

- [ ] **Step 5: 实现规则增删改、错误与复制交互**

规则动态文本全部通过 `textContent` 创建。保存时提交原始正则字符串，不添加 `/` 或 flags；前端检查必含非空和两字段长度不超过 256。删除前使用确认框。成功后只执行 `loadRules()`；失败时在 dialog 内展示服务端消息。

复制优先使用：

```js
await navigator.clipboard.writeText(subscriptionUrl);
```

复制权限失败时显示 toast，保留可手动选择的只读 URL。

- [ ] **Step 6: 添加响应式样式并控制最小影响范围**

复用现有 panel、button、modal、toast 变量和组件样式，仅新增规则卡片、正则代码块、订阅链接行及移动端换行样式；不重排既有平台和条目区域，不引入外部字体或图标。

- [ ] **Step 7: 运行前端测试和全量测试**

Run:

```bash
cd backend
node --test --experimental-test-isolation=none tests/frontend.test.js
npm test
```

Expected: 前端聚焦测试和全部后端测试 PASS。

- [ ] **Step 8: 提交前端规则管理**

```bash
git add backend/public/index.html backend/public/styles.css backend/public/app.js backend/tests/frontend.test.js
git diff --cached --check
git commit -m "feat: 添加 RSS 分流规则管理页面"
```

---

### Task 5: Docker、README 与最终验收

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/README.md`
- Modify: `backend/tests/docker-persistence.test.js`

**Interfaces:**
- Docker 镜像必须包含 `/app/templates/subscription.xml`
- README 必须说明规则接口、订阅地址、正则语义和可信网络边界

- [ ] **Step 1: 编写 Docker 母版复制失败测试**

在 `docker-persistence.test.js` 增加：

```js
assert.match(dockerfile, /COPY --chown=node:node templates \.\/templates/);
assert.match(dockerfile, /COPY --chown=node:node data \.\/data/);
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `cd backend && node --test --experimental-test-isolation=none tests/docker-persistence.test.js`

Expected: FAIL，Dockerfile 尚未复制 `templates`。

- [ ] **Step 3: 修改 Dockerfile**

在复制 `public` 后增加：

```dockerfile
COPY --chown=node:node templates ./templates
```

保留现有 `COPY --chown=node:node data ./data` 和 `/app/data` 命名卷行为。

- [ ] **Step 4: 更新 README**

补充：

- `GET/POST /rss/rules`、`PUT/DELETE /rss/rules/:id`。
- `/rss/subscriptions/matched` 和 `/rss/subscriptions/unmatched`。
- 正则默认忽略大小写，单条规则 AND、多条规则 OR、空规则行为。
- 订阅响应为 `text/xml; charset=utf-8`，只读取缓存。
- `data/rss-rules.json` 和 `templates/` 目录职责。
- item 可能携带 passkey，无鉴权接口只能在可信网络使用。

- [ ] **Step 5: 运行最终自动化验证**

Run:

```bash
cd backend
npm test
cd ..
git diff --check
git status --short
```

Expected: 全部测试 PASS；`git diff --check` 无输出；仅存在本任务预期修改。

- [ ] **Step 6: 启动服务并执行 HTTP 冒烟**

在临时端口启动：

```bash
cd backend
PORT=30003 npm start
```

另一个终端执行：

```bash
curl -sS -i http://127.0.0.1:30003/rss/rules
curl -sS -i http://127.0.0.1:30003/rss/subscriptions/matched
curl -sS -i http://127.0.0.1:30003/rss/subscriptions/unmatched
curl -sS -i http://127.0.0.1:30003/
```

Expected:

- 规则列表返回 HTTP 200 和统一 JSON。
- 两个订阅返回 HTTP 200、`Content-Type: text/xml; charset=utf-8`、`Cache-Control: no-store` 和合法 RSS。
- 页面返回 HTTP 200 并包含规则管理区域。
- 冒烟不调用刷新接口，不访问真实外部 RSS。

- [ ] **Step 7: 提交部署和文档**

```bash
git add backend/Dockerfile backend/README.md backend/tests/docker-persistence.test.js
git diff --cached --check
git commit -m "docs: 完善 RSS 分流订阅部署说明"
```

## 最终验收

- [ ] 规则 CRUD 可用，错误状态符合 400/404 约定。
- [ ] 正则默认忽略大小写，单条规则 AND、多条规则 OR。
- [ ] 无规则时 matched 为空、unmatched 包含全部缓存。
- [ ] 两个订阅互斥并覆盖全部缓存，按 `pubDate` 倒序。
- [ ] 订阅接口不带 `.xml`，返回 `text/xml; charset=utf-8` 和 `Cache-Control: no-store`。
- [ ] 原始 item、enclosure、guid 和下载链接精确保留。
- [ ] 订阅请求不调用外部 fetch，规则修改无需刷新缓存即可生效。
- [ ] 管理台支持规则增删改、错误提示和两个链接复制。
- [ ] Docker 镜像包含模板，规则文件由现有 `/app/data` 命名卷持久化。
- [ ] `cd backend && npm test` 全部通过。
- [ ] `git diff --check` 通过，不自动 Push。
