# qBittorrent RSS 订阅分流设计

## 目标

在现有 RSS 聚合缓存之上增加一套全局 title 正则规则，为 qBittorrent 提供“命中”和“非命中”两个固定 RSS 订阅地址。订阅请求只读取本地缓存，不请求外部 RSS；规则修改后立即影响下一次订阅响应。

## 范围

本次包含：

- 全局分流规则的查询、新增、修改和删除。
- 使用忽略大小写的正则表达式匹配缓存条目的 `title`。
- 动态生成命中与非命中两份 RSS XML。
- 在现有 HTML、CSS、JavaScript 管理台中管理规则和复制订阅地址。
- JSON 文件持久化、Docker 数据卷兼容、接口和前端自动化测试。

本次不包含：

- 按平台分别配置规则或创建多套分流方案。
- 在订阅 URL 中携带临时规则。
- 预生成或持久化 `matched.xml`、`unmatched.xml`。
- 订阅接口鉴权、用户体系或公网暴露能力。
- 订阅请求期间刷新外部 RSS。

## 已确认决策

- `mustInclude` 和 `mustExclude` 都是正则表达式内容，不是普通关键词。
- 服务端统一使用 `new RegExp(pattern, 'i')`，默认忽略大小写；配置不使用 `/.../i` 包装。
- 单条规则命中条件为：`mustInclude` 匹配，并且可选的 `mustExclude` 不匹配。
- 多条规则使用 OR：任意规则命中即进入命中订阅。
- 没有规则时，命中订阅为空，非命中订阅包含全部缓存条目。
- 使用一套作用于全部平台缓存条目的全局规则。
- 固定订阅地址不带 `.xml` 后缀。
- 成功响应的 Content-Type 为 `text/xml; charset=utf-8`。
- 订阅链接不增加鉴权，只允许部署在可信网络。

## 数据模型与持久化

新增 `backend/data/rss-rules.json`，初始内容为 `[]`。每条规则结构如下：

```json
{
  "id": "e02f6f66-282f-44ba-bf93-f68cd442adcb",
  "mustInclude": "2160p|4K",
  "mustExclude": "杜比视界|DV"
}
```

- `id` 由服务端生成 UUID，作为修改和删除的稳定标识。
- `mustInclude` 必须为非空字符串。
- `mustExclude` 为可选字符串；缺省或空字符串表示不设置排除条件。
- 正则保存用户输入的原文，不自动转义或改写。
- 内容完全相同的重复规则允许保存，因为不会改变最终分流结果。

现有 RSS repository 增加规则读取和原子写入方法，继续使用同目录临时文件加重命名。Docker Compose 已挂载整个 `/app/data`，因此新增规则文件沿用现有命名卷持久化，无需新增卷。

## 组件边界

### Repository

`rss.repository.js` 负责：

- 缺少 `rss-rules.json` 时初始化为空数组。
- 读取完整规则数组。
- 原子保存完整规则数组。
- 与平台及缓存文件共用同一数据目录写入队列，避免并发写操作互相覆盖。

Repository 不编译正则、不执行分流，也不生成 XML。

### Subscription Service

新增独立的订阅分流 Service，负责：

- 规则 CRUD 和业务校验。
- 将规则编译为忽略大小写的正则。
- 读取现有聚合缓存并按规则分流。
- 复用现有聚合列表的 `pubDate` 倒序规则。
- 将筛选后的原始 `item.xml` 插入 RSS 母版。

分流能力与外部 RSS 拉取保持分离，订阅请求不依赖 `fetch`。应用组装允许注入分流 Service，便于接口测试验证其不会访问外部网络。

### Template

把需求文件 `prds/rss 订阅示例/template.xml` 复制为后端运行模板。运行时不直接依赖 `prds/`。

模板保留现有 channel 元数据和唯一 item 占位注释。生成器只替换该占位注释：

- 有条目时按排序结果拼接原始 `item.xml`。
- 无条目时移除占位注释，仍返回合法的空 RSS。
- 不解析并重新序列化 item，不修改 enclosure、guid、CDATA、实体或空白内容。

## HTTP 接口

### 查询规则

```http
GET /rss/rules
```

使用现有统一 JSON 成功响应，`data` 为规则数组。

### 新增规则

```http
POST /rss/rules
Content-Type: application/json

{
  "mustInclude": "2160p|4K",
  "mustExclude": "杜比视界|DV"
}
```

成功返回 HTTP 201 和服务端生成的完整规则。

### 修改规则

```http
PUT /rss/rules/:id
Content-Type: application/json
```

请求体字段与新增规则一致，成功返回更新后的完整规则。

### 删除规则

```http
DELETE /rss/rules/:id
```

成功返回被删除的规则。

### 命中订阅

```http
GET /rss/subscriptions/matched
```

直接返回命中任意规则的 RSS XML。

### 非命中订阅

```http
GET /rss/subscriptions/unmatched
```

直接返回未命中任何规则的 RSS XML。

两个订阅接口成功响应均设置：

```http
Content-Type: text/xml; charset=utf-8
Cache-Control: no-store
```

订阅响应不使用 JSON 包装。

## 匹配和排序规则

每次订阅请求读取本地缓存和当前规则。对每条规则分别编译：

```js
const includePattern = new RegExp(rule.mustInclude, 'i');
const excludePattern = rule.mustExclude
  ? new RegExp(rule.mustExclude, 'i')
  : null;
```

单条规则命中逻辑：

```js
includePattern.test(title)
  && (!excludePattern || !excludePattern.test(title))
```

条目分流规则：

- 任意规则命中则只进入 `matched`。
- 所有规则均未命中则只进入 `unmatched`。
- `title` 为空时无法命中必含正则，进入 `unmatched`。
- 没有规则时所有条目进入 `unmatched`。
- 不额外去重；保持现有缓存条目集合。

筛选后继续按现有聚合接口的规则排序：有效 `pubDate` 倒序，无效日期排在末尾，相同时间保持稳定顺序。

## 校验与错误处理

规则保存前执行以下校验：

- `mustInclude` 类型错误或仅包含空白：HTTP 400。
- `mustExclude` 不是字符串：HTTP 400。
- 必含或必不含正则无法编译：HTTP 400，并指出对应字段。
- 单个正则超过 256 个字符：HTTP 400。
- 已保存规则达到 100 条时继续新增：HTTP 400。
- 修改或删除不存在的 ID：HTTP 404。

检查是否为空时可忽略首尾空白，但持久化和编译使用原始正则内容，避免改变有意匹配空格的表达式。

下列情况作为服务级错误交给统一错误中间件转换为安全 HTTP 500：

- 规则或缓存 JSON 损坏。
- 已持久化规则包含无效正则。
- RSS 模板缺失、无法读取或缺少唯一占位注释。
- 文件写入失败。

错误响应不泄露正则堆栈、文件路径、原始 item、下载凭据或内部异常信息。Content-Type 和 Cache-Control 约定只保证成功的订阅响应；失败响应沿用统一 JSON 错误格式。

## 并发一致性

- 规则写入与现有平台、缓存写入共用数据目录写入队列。
- 所有文件都通过临时文件加重命名替换，订阅请求只会看到完整旧版或完整新版。
- 规则修改不触发缓存刷新；保存成功后的下一次订阅请求立即使用新规则。
- 订阅请求只读本地文件，不参与外部 RSS 刷新互斥，也不会延长刷新锁持有时间。

## 前端设计

现有管理台增加“分流规则”面板：

- 页面初始化时并行读取平台、缓存条目和规则。
- 展示全部规则的必含和必不含正则。
- 支持新增、编辑和删除；编辑时使用规则 ID 定位。
- 表单提示“默认忽略大小写，不需要填写 `/.../i`”。
- 前端只做必填和长度等基础校验，服务端仍是最终校验来源。
- 服务端返回的具体错误显示在表单中，不清空已有规则列表。
- 保存或删除成功后只重新加载规则，不刷新外部 RSS 或条目缓存。
- 展示命中和非命中两个基于当前 origin 的完整订阅 URL。
- 每个 URL 提供复制按钮和新窗口打开入口。

动态规则内容继续通过 DOM `textContent` 写入，不拼接不可信 HTML。

## 安全边界

- 原始 item XML 可能包含带 passkey 的 enclosure 下载地址，两个订阅链接不得直接暴露到公网。
- 管理接口与订阅接口均沿用当前可信网络部署前提，本次不增加鉴权。
- JavaScript 正则没有原生执行超时。256 字符和 100 条限制只能降低错误配置风险，不能彻底防止灾难性回溯；规则管理权限必须限制给可信用户。
- 订阅请求不访问用户配置的外部 URL，不新增 SSRF 面。

## 测试设计

### Repository

- 缺少规则文件时初始化为空数组。
- 规则保存后可再次读取。
- 并发初始化和写入不产生半文件或覆盖已完成写入。
- 损坏 JSON 明确报错且不被静默覆盖。

### Service

- 规则新增、列表、修改和删除。
- 字段类型、空必含、无效正则、长度和数量限制。
- 正则默认忽略大小写。
- 必含命中、必不含排除、多规则 OR。
- 空规则、空 title 和重复规则。
- 命中与非命中互斥并覆盖全部缓存条目。
- 有效日期倒序、无效日期末尾和稳定顺序。

### XML

- 精确替换唯一模板占位符。
- 原始 item XML、CDATA、enclosure 和 guid 保持不变。
- 空结果仍生成合法 RSS。
- 模板缺失或占位符异常时失败。

### API

- 规则 CRUD 返回 200、201、400 和 404。
- 两个订阅路径不含 `.xml`。
- 成功响应为 `text/xml; charset=utf-8`，并包含 `Cache-Control: no-store`。
- 订阅响应不使用 JSON 包装。
- 订阅请求只读取缓存，不调用外部 fetch。

### 前端

- API client 使用约定的规则路径和请求方法。
- 页面包含规则管理区域及两个订阅地址。
- 正则说明、空状态、保存错误、复制和删除确认行为可用。

### 回归与冒烟

- 运行现有全部测试，确保平台 CRUD、缓存刷新、聚合查询和管理台不回归。
- 启动服务后请求规则列表、命中订阅和非命中订阅，检查状态码、响应头与 XML 结构。
- 自动化测试与冒烟不刷新真实外部 RSS。

## 验收标准

- 可以在管理页面增删改全局正则规则。
- 正则匹配默认忽略大小写，多条规则使用 OR。
- `/rss/subscriptions/matched` 只包含命中条目。
- `/rss/subscriptions/unmatched` 只包含非命中条目。
- 两个结果互斥且覆盖全部本地缓存条目。
- 无规则时命中订阅为空，非命中订阅包含全部缓存。
- 两个接口返回 `text/xml; charset=utf-8` 和 `Cache-Control: no-store`。
- XML 使用母版并精确保留原始 item 内容。
- 订阅请求不访问外部网络，规则修改后立即生效。
- 规则、缓存和平台数据在 Docker 命名卷中持久化。
- 全部自动化测试通过，且不执行自动 Push。

## 未覆盖风险

- 本次不提供正则执行超时，可信用户仍可能配置导致事件循环长时间阻塞的表达式。
- 本次不增加接口鉴权或订阅 token，部署边界依赖可信网络。
- 当前使用 JSON 全量读取和写入，适用于现有轻量数据规模；规则或缓存显著增长后需重新评估存储方式。
