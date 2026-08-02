# Docker Compose 部署实现计划

> **执行要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施。每一步使用复选框跟踪。

**目标：** 为现有 Koa 后端增加基于 `node:22-slim` 多阶段镜像的单服务 Docker Compose 部署能力。

**架构：** `backend/Dockerfile` 构建只含生产依赖和源码的非 root 运行镜像，根目录 `docker-compose.yml` 负责端口映射、环境变量、进程初始化、重启策略和健康检查。部署内容不挂载宿主机源码或依赖，运行结果完全来自镜像。

**技术栈：** Docker Engine、Docker Compose v2、`node:22-slim`、Koa、Node.js 内置 `fetch()` 健康检查。

## 全局约束

- 使用 `node:22-slim`，不使用 Alpine 镜像。
- Dockerfile 必须采用多阶段构建。
- 运行镜像只包含生产依赖、包元数据和 `src/`。
- 容器必须使用 Node 镜像内置的 `node` 非 root 用户。
- Compose 首版只包含 `backend` 服务。
- 容器内部固定使用 `NODE_ENV=production`、`PORT=3000`。
- 主机端口使用 `${BACKEND_PORT:-3000}` 配置。
- 不加入 Nginx、HTTPS、数据库、缓存、消息队列或持久化卷。
- 不自动 Push。
- 当前执行环境未安装 Docker CLI，真实容器验证前必须先让终端可执行 `docker` 与 `docker compose`。

---

## 文件结构

- `backend/Dockerfile`：生产依赖与运行镜像的多阶段构建规则。
- `backend/.dockerignore`：排除本地依赖、测试、环境变量和无关文件。
- `docker-compose.yml`：编排后端容器、端口、环境变量和健康检查。
- `.env.example`：Compose 主机端口变量示例。
- `backend/README.md`：补充 Docker Compose 部署操作说明。

---

### 任务 1：创建多阶段生产镜像

**文件：**

- 创建：`backend/Dockerfile`
- 创建：`backend/.dockerignore`

**接口：**

- 输入：`backend/package.json`、`backend/package-lock.json`、`backend/src/`
- 输出：以 `node` 用户执行 `node src/server.js` 的生产镜像
- 暴露端口：`3000`

- [ ] **步骤 1：运行文件存在性检查并确认失败**

运行：

```bash
test -f backend/Dockerfile && test -f backend/.dockerignore
```

预期：FAIL，退出码非 0，因为两个容器构建文件尚不存在。

- [ ] **步骤 2：创建 Dockerfile**

创建 `backend/Dockerfile`：

```dockerfile
FROM node:22-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
```

- [ ] **步骤 3：创建 Docker 构建忽略规则**

创建 `backend/.dockerignore`：

```dockerignore
node_modules
tests
support
coverage
.env
.env.*
*.log
npm-debug.log*
.git
.gitignore
.editorconfig
.prettierrc*
README.md
```

- [ ] **步骤 4：验证 Dockerfile 关键约束**

运行：

```bash
test "$(rg -c '^FROM node:22-slim' backend/Dockerfile)" -eq 2
rg -q '^RUN npm ci --omit=dev$' backend/Dockerfile
rg -q '^USER node$' backend/Dockerfile
rg -q '^CMD \["node", "src/server.js"\]$' backend/Dockerfile
rg -q '^node_modules$' backend/.dockerignore
```

预期：全部命令成功，退出码为 0。

- [ ] **步骤 5：在 Docker 可用时构建镜像**

运行：

```bash
docker build --target runtime -t z-rss-backend:local backend
```

预期：镜像构建成功，依赖阶段执行 `npm ci --omit=dev`，运行阶段基于 `node:22-slim`。

- [ ] **步骤 6：提交任务 1**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "build: 添加 Koa 后端生产镜像"
```

---

### 任务 2：创建 Docker Compose 编排配置

**文件：**

- 创建：`docker-compose.yml`
- 创建：`.env.example`

**接口：**

- 输入：可选的根目录 `.env` 中 `BACKEND_PORT`
- 输出：名为 `backend` 的 Compose 服务
- 主机端口：`${BACKEND_PORT:-3000}`
- 容器端口：`3000`

- [ ] **步骤 1：运行 Compose 文件存在性检查并确认失败**

运行：

```bash
test -f docker-compose.yml && test -f .env.example
```

预期：FAIL，退出码非 0，因为 Compose 配置尚不存在。

- [ ] **步骤 2：创建 Compose 配置**

创建 `docker-compose.yml`：

```yaml
services:
  backend:
    image: z-rss-backend:local
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: runtime
    init: true
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
    ports:
      - "${BACKEND_PORT:-3000}:3000"
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:3000/health')
          .then((response) => {
            if (!response.ok) process.exit(1);
          })
          .catch(() => process.exit(1));
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
```

- [ ] **步骤 3：创建 Compose 环境变量示例**

创建根目录 `.env.example`：

```dotenv
BACKEND_PORT=3000
```

- [ ] **步骤 4：静态验证关键配置**

运行：

```bash
rg -q '^  backend:$' docker-compose.yml
rg -q 'image: z-rss-backend:local' docker-compose.yml
rg -q 'node:22-slim' backend/Dockerfile
rg -q '\$\{BACKEND_PORT:-3000\}:3000' docker-compose.yml
rg -q 'NODE_ENV: production' docker-compose.yml
rg -q 'restart: unless-stopped' docker-compose.yml
rg -q '127\.0\.0\.1:3000/health' docker-compose.yml
```

预期：全部命令成功，退出码为 0。

- [ ] **步骤 5：在 Docker 可用时解析 Compose 配置**

运行：

```bash
docker compose config
```

预期：退出码为 0，解析结果包含 `backend` 服务、`3000` 容器端口和健康检查。

- [ ] **步骤 6：提交任务 2**

```bash
git add docker-compose.yml .env.example
git commit -m "build: 添加后端 Docker Compose 编排"
```

---

### 任务 3：补充 Docker Compose 部署文档

**文件：**

- 修改：`backend/README.md`

**接口：**

- 输出：安装前提、配置、构建启动、状态、日志和停止命令。

- [ ] **步骤 1：检查部署章节并确认缺失**

运行：

```bash
rg -q '^## Docker Compose 部署$' backend/README.md
```

预期：FAIL，退出码非 0，因为 README 尚无容器部署章节。

- [ ] **步骤 2：追加部署说明**

在 `backend/README.md` 末尾追加：

```markdown
## Docker Compose 部署

Docker Compose 命令在仓库根目录执行。

复制环境变量示例并按需修改主机端口：

\`\`\`bash
cp .env.example .env
\`\`\`

构建并后台启动服务：

\`\`\`bash
docker compose up -d --build
\`\`\`

查看容器与健康状态：

\`\`\`bash
docker compose ps
\`\`\`

查看后端日志：

\`\`\`bash
docker compose logs -f backend
\`\`\`

停止并移除容器：

\`\`\`bash
docker compose down
\`\`\`
```

- [ ] **步骤 3：验证 README 命令完整**

运行：

```bash
rg -q '^## Docker Compose 部署$' backend/README.md
rg -q 'docker compose up -d --build' backend/README.md
rg -q 'docker compose ps' backend/README.md
rg -q 'docker compose logs -f backend' backend/README.md
rg -q 'docker compose down' backend/README.md
```

预期：全部命令成功，退出码为 0。

- [ ] **步骤 4：运行现有后端测试**

运行：

```bash
cd backend
npm test
```

预期：5 个测试全部通过。

- [ ] **步骤 5：提交任务 3**

```bash
git add backend/README.md
git commit -m "docs: 补充 Docker Compose 部署说明"
```

---

### 任务 4：执行真实容器部署验收

**文件：**

- 验证：`backend/Dockerfile`
- 验证：`backend/.dockerignore`
- 验证：`docker-compose.yml`
- 验证：`.env.example`
- 验证：`backend/README.md`

**前置条件：**

- `docker --version` 成功。
- `docker compose version` 成功。
- Docker daemon 可访问。
- 主机默认端口 `3000` 可用；若不可用，执行命令时设置 `BACKEND_PORT` 为其他可用端口。

- [ ] **步骤 1：验证 Docker 环境**

运行：

```bash
docker --version
docker compose version
docker info
```

预期：三个命令均成功。若当前终端仍返回 `docker: command not found`，停止真实部署验收并报告环境阻塞，不伪造构建或运行结果。

- [ ] **步骤 2：解析并构建 Compose 项目**

运行：

```bash
docker compose config
docker compose build
```

预期：Compose 配置解析成功，`z-rss-backend:local` 镜像构建成功。

- [ ] **步骤 3：启动后端容器**

运行：

```bash
docker compose up -d
```

预期：`backend` 服务创建并启动。

- [ ] **步骤 4：等待健康状态**

运行：

```bash
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  container_status=$(docker compose ps --format json backend)
  if printf '%s' "$container_status" | rg -q '"Health":"healthy"'; then
    break
  fi
  sleep 2
done
docker compose ps backend
```

预期：最终状态包含 `healthy`。若 20 秒内未健康，运行 `docker compose logs backend` 收集实际错误。

- [ ] **步骤 5：验证容器用户和 HTTP 接口**

运行：

```bash
test "$(docker compose exec -T backend id -u)" != "0"
compose_backend_port=$(docker compose port backend 3000 | awk -F: '{print $NF}')
curl -i -sS "http://127.0.0.1:${compose_backend_port}/health"
curl -i -sS "http://127.0.0.1:${compose_backend_port}/unknown"
```

预期：容器 UID 非 0；健康检查返回 HTTP `200`；未知路由返回 HTTP `404`。

- [ ] **步骤 6：停止并移除容器**

运行：

```bash
docker compose down
```

预期：本项目容器和 Compose 网络被移除，镜像保留以便后续启动。

- [ ] **步骤 7：执行最终验证**

运行：

```bash
cd backend
npm test
cd ..
docker compose config
git diff --check
git status --short
```

预期：5 个测试通过；Compose 配置解析成功；格式检查无输出；工作区只包含本次计划内文件。

- [ ] **步骤 8：提交计划和会话记录**

```bash
git add plans/2026-08-02_DockerCompose部署实现计划.md sessions/session_2026-08-02.md
git commit -m "docs: 记录 Docker Compose 部署计划"
```

## 未覆盖风险

- 当前终端没有 Docker CLI，未提供 Docker 环境前无法执行镜像构建和真实容器验收。
- 未配置反向代理与 HTTPS，不应直接作为公网 TLS 终止服务。
- 健康检查只标记容器状态，不会自动替换 `unhealthy` 容器。
- 未配置持久化卷；未来增加持久化数据后需要重新设计存储挂载与备份。
