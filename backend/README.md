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

## 测试

```bash
npm test
```

## 接口

- `GET /health`：返回服务状态、当前时间和进程运行时长。

## 目录职责

- `routes/`：声明请求方法与路径。
- `controllers/`：处理请求上下文并组织响应。
- `services/`：承载业务逻辑，不依赖 Koa 上下文。
- `middlewares/`：处理跨请求逻辑。
- `utils/`：提供无状态通用方法。
- `config/`：集中管理环境配置。

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
