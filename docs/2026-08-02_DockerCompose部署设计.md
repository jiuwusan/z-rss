# Docker Compose 部署设计

## 目标

为现有 Koa 后端提供基于 Docker Compose 的单机部署方案。使用 `node:22-slim` 多阶段镜像，只携带生产依赖和运行源码，支持环境变量端口映射、健康检查、自动重启和非 root 用户运行。

## 范围

### 本次包含

- 后端多阶段生产 Dockerfile。
- Docker 构建上下文忽略规则。
- 单服务 `docker-compose.yml`。
- 主机端口环境变量示例。
- 容器健康检查。
- 构建、启动、请求验证和停止流程。
- 后端 README 中的容器部署说明。

### 本次不包含

- Nginx 或其他反向代理。
- HTTPS 与证书管理。
- 数据库、缓存或消息队列。
- 镜像仓库推送流程。
- Kubernetes 或其他编排平台。
- 容器健康异常后的自动重建机制。

## 文件结构

```text
/
├── docker-compose.yml
├── .env.example
└── backend/
    ├── Dockerfile
    ├── .dockerignore
    └── README.md
```

## 镜像设计

Dockerfile 使用两个 `node:22-slim` 阶段：

1. `dependencies` 阶段只复制 `package.json` 与 `package-lock.json`，执行 `npm ci --omit=dev` 安装锁定的生产依赖。
2. `runtime` 阶段复制生产依赖、包元数据与 `src/`，不包含测试、开发依赖和本地 `node_modules`。

运行阶段配置：

- 工作目录为 `/app`。
- `NODE_ENV` 默认为 `production`。
- 声明容器端口 `3000`。
- 文件归属设置为 Node 镜像内置的 `node` 用户。
- 使用 `USER node`，禁止以 root 用户运行应用。
- 使用 `CMD ["node", "src/server.js"]` 直接启动服务。

构建过程中 `package-lock.json` 与 `package.json` 不一致时，`npm ci` 必须失败，避免生成不可复现镜像。

## Docker 构建上下文

`backend/.dockerignore` 排除：

- 本地 `node_modules`。
- 测试与测试辅助文件。
- `.env` 及其他本地环境配置。
- 日志、覆盖率和临时文件。
- Git 元数据、编辑器配置和说明文档。

Dockerfile、包元数据和 `src/` 保留在构建上下文中。

## Compose 服务设计

Compose 只定义 `backend` 服务：

- 构建上下文：`./backend`。
- Dockerfile：`./backend/Dockerfile`。
- 本地镜像名：`z-rss-backend:local`。
- 容器内部环境变量：`NODE_ENV=production`、`PORT=3000`。
- 端口映射：`${BACKEND_PORT:-3000}:3000`。
- 进程管理：`init: true`。
- 重启策略：`unless-stopped`。

不挂载源码、依赖目录或宿主机数据，确保运行内容完全来自已构建镜像。

仓库根目录 `.env.example` 提供：

```dotenv
BACKEND_PORT=3000
```

部署者可复制为根目录 `.env` 并修改主机暴露端口。容器内部端口保持 `3000`，不接受主机端口变量覆盖。

## 健康检查

健康检查在容器内使用 Node.js 内置 `fetch()` 请求：

```text
http://127.0.0.1:3000/health
```

参数：

- 间隔：10 秒。
- 超时：3 秒。
- 重试：5 次。
- 启动宽限期：10 秒。

请求失败或返回非 2xx 状态时以非零状态退出。镜像不额外安装 `curl`。

`restart: unless-stopped` 仅在容器进程退出后触发重启。健康状态变为 `unhealthy` 时，Compose 不自动重建容器，健康检查仅用于状态观测和外部监控集成。

## 请求与配置流

1. Compose 从仓库根目录 `.env` 读取可选的 `BACKEND_PORT`。
2. Compose 将主机端口映射到容器的 `3000`。
3. 容器以 `NODE_ENV=production`、`PORT=3000` 启动 `src/server.js`。
4. Koa 服务响应 `/health` 与现有路由。
5. Docker 定期在容器内部请求 `/health` 更新健康状态。

## 错误处理

- 镜像构建失败：保留 `npm ci` 非零退出结果，不增加回退安装逻辑。
- 端口已占用：`docker compose up` 直接失败，由部署者修改 `BACKEND_PORT`。
- 服务启动失败：容器进程退出，由 `unless-stopped` 策略重启。
- 健康检查失败：容器标记为 `unhealthy`，通过 `docker compose ps` 和容器日志定位。
- 环境变量未配置：主机端口默认使用 `3000`。

## 文档更新

`backend/README.md` 增加 Docker Compose 部署章节，说明：

- 配置根目录 `.env`。
- 构建与后台启动命令。
- 查看服务和健康状态。
- 查看日志。
- 停止并移除容器。

## 验证设计

静态验证：

```bash
docker compose config
```

构建验证：

```bash
docker compose build
```

运行验证：

```bash
docker compose up -d
docker compose ps
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/unknown
docker compose down
```

验收标准：

- Compose 配置解析成功。
- 镜像基于 `node:22-slim` 多阶段构建成功。
- 容器以非 root 用户运行。
- 容器状态在启动宽限期后变为 `healthy`。
- `/health` 返回 HTTP `200` 和统一成功响应。
- 未知路由返回 HTTP `404` 和统一错误响应。
- `docker compose down` 后不保留运行中的本项目容器。
- 现有 `npm test` 继续全部通过。

## 风险与边界

- 未配置反向代理与 HTTPS，不应直接作为公网 TLS 终止服务。
- 未配置持久化卷；当前后端没有持久化数据，因此不影响现有功能。
- 使用 `node:22-slim`，镜像体积高于 Alpine，但原生依赖兼容性更稳妥。
- Compose 健康检查不负责自动替换 `unhealthy` 容器。
