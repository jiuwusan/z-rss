# Z-RSS Backend

基于 Koa 的 Z-RSS 后端服务，采用 ES Modules 和经典技术分层。

## 环境要求

- Node.js 22 或更高版本
- npm 10 或更高版本

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 为 `.env`，按需修改：

- `PORT`：服务端口，默认 `3000`。
- `NODE_ENV`：运行环境，默认 `development`。

## 运行

```bash
npm run dev
npm start
```

服务启动后访问 `http://localhost:3000/` 打开 RSS 管理台。页面使用原生 HTML、CSS 和 JavaScript 实现，可管理订阅平台、刷新全部缓存、查看聚合条目及原始 item XML。

前端页面与 RSS API 由同一个 Koa 服务提供，浏览器只请求同源的 `/rss/*` 接口，不会直接访问外部 RSS 地址。聚合列表只读取服务端缓存。

## 测试

```bash
npm test
```

## 接口

- `GET /health`：返回服务状态、当前时间和进程运行时长。

## RSS 接口

- `GET /rss/platforms`：查询订阅平台。
- `POST /rss/platforms`：新增订阅平台。
- `PUT /rss/platforms/:platform`：修改平台 RSS 地址。
- `DELETE /rss/platforms/:platform`：删除平台及对应缓存。
- `POST /rss/cache/refresh`：主动拉取全部平台并刷新缓存。
- `GET /rss/items`：读取按发布时间倒序排列的全部缓存条目。

> 安全提示：RSS 管理与刷新接口必须限制在可信网络或可信用户范围内；未配置认证与 SSRF 防护时，不得直接公开暴露。

运行数据保存在 `data/platforms.json` 和 `data/rss-cache.json`。聚合查询只读取本地缓存，不会实时请求外部 RSS。

Docker Compose 使用 `rss-data` 命名卷挂载 `/app/data`。普通 `docker compose down` 不删除数据；执行 `docker compose down -v` 会删除平台配置和 RSS 缓存，请谨慎使用。

## 目录职责

- `routes/`：声明请求方法与路径。
- `controllers/`：处理请求上下文并组织响应。
- `services/`：承载业务逻辑，不依赖 Koa 上下文。
- `repositories/`：读取并原子写入本地 JSON 数据文件。
- `parsers/`：校验 RSS XML 并提取聚合条目。
- `middlewares/`：处理跨请求逻辑。
- `utils/`：提供无状态通用方法。
- `config/`：集中管理环境配置。
- `public/`：保存 RSS 管理台的 HTML、CSS 和 JavaScript 静态资源。
- `data/`：保存订阅平台和 RSS 聚合缓存。

## Docker Compose 部署

Docker Compose 命令在仓库根目录执行。

复制环境变量示例并按需修改主机端口：

```bash
cp .env.example .env
```

构建并后台启动服务：

```bash
docker compose up -d --build
```

查看容器与健康状态：

```bash
docker compose ps
```

查看后端日志：

```bash
docker compose logs -f backend
```

停止并移除容器：

```bash
docker compose down
```
