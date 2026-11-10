# xiaohongshu-mcp 部署（主题深挖数据源）

「主题深挖」的数据源是开源项目 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)（Go 编写的 MCP 服务，内置无头浏览器驱动小红书网页）。它作为**独立进程**运行，本仓库不导入其代码；服务端通过 `server/src/xhs-mcp.ts` 的 `XhsMcpClient` 以 MCP Streamable HTTP 协议调用（JSON-RPC 2.0，上游以 Stateless 模式挂载 `/mcp`，可直接 `tools/call`，无需 initialize 握手）。

MCP 地址：`http://127.0.0.1:18060/mcp`；健康检查：`GET http://127.0.0.1:18060/health`。

## 安全约束（Issue #18，硬性要求）

以下六条来自 Archivist 对上游仓库的审查结论，升级 / 改配置时不得放宽：

| # | 约束 | 落法 |
| --- | --- | --- |
| 1 | 锁定上游 commit `3b352aa`，不追最新 | 从该 commit 本地构建镜像（部署第 1-2 步）。上游没有 release tag 指向该 commit，**不要**用 `xpzouying/xiaohongshu-mcp:latest` 或 `:vX.Y.Z` |
| 2 | 开 `AUTH_TOKEN`，服务只绑定 `127.0.0.1` | compose 中 `AUTH_TOKEN` 未设置则拒绝启动；端口映射限定回环地址 |
| 3 | 只接 `search_feeds` / `get_feed_detail`（及登录状态 `check_login_status`）三个只读工具 | `XhsMcpClient` 内置白名单 + 运行时守卫（`READ_ONLY_TOOLS`）。上游同时暴露发帖 / 评论 / 点赞 / 收藏等写工具，本工作台一律不调用 |
| 4 | cookies 放 0700 权限目录 | cookies 落 `server/mcp/data/cookies.json`（仅本机可见的挂载卷），宿主机目录 `chmod 700`（部署第 3 步） |
| 5 | Docker 运行，端口只映射 `127.0.0.1:18060:18060` | compose `ports: "127.0.0.1:18060:18060"`（上游默认 compose 是 `18060:18060` 全网卡，不能照抄） |
| 6 | 不导入仓库里的 `skills/post-to-xhs/` 与 `CLAUDE.md` | 上游克隆目录只作 Docker 构建上下文且已 gitignore（`.gitignore`），最终镜像只含 Go 二进制与浏览器运行时；这两个路径不进入本仓库 |

## 部署

前置：Docker 与约 2GB 磁盘（首次构建会下载 Go 工具链与 Chromium ~150MB）。

```shell
cd server/mcp

# 1. 取上游源码并锁定到审查通过的 commit（约束 #1）
git clone https://github.com/xpzouying/xiaohongshu-mcp xiaohongshu-mcp-src
git -C xiaohongshu-mcp-src checkout 3b352aa

# 2. 生成访问令牌（约束 #2），并保存好；工作台服务端要用同一个值
export AUTH_TOKEN=$(openssl rand -hex 32)

# 3. 准备数据目录并收紧权限（约束 #4：cookies 在这里）
mkdir -m 700 data

# 4. 构建并启动（约束 #5：端口只映射到 127.0.0.1）
docker compose up -d --build

# 5. 验证
curl -s http://127.0.0.1:18060/health
```

## 登录（QR 扫码）

登录由 xiaohongshu-mcp 自己管理（QR 码 + cookie 持久化，本仓库不接触账号密码）：

1. 用任意 MCP 客户端（Cursor / Claude Desktop 等）接入 `http://127.0.0.1:18060/mcp`，请求头带 `Authorization: Bearer <AUTH_TOKEN>`；
2. 调用其 `get_login_qrcode` 工具，用小红书 App 扫码；
3. 扫码成功后 cookies 自动落盘 `server/mcp/data/cookies.json`，重启容器不丢；
4. 登录状态可用工作台的 `XhsMcpClient.checkLoginStatus()` 或 MCP 客户端调 `check_login_status` 验证。

## 工作台服务端接入

`XhsMcpClient`（`server/src/xhs-mcp.ts`）从环境变量读取连接配置：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `XHS_MCP_URL` | `http://127.0.0.1:18060/mcp` | MCP 服务地址，须指向上面部署的回环地址 |
| `XHS_MCP_AUTH_TOKEN` | 无 | 与部署时的 `AUTH_TOKEN` 一致；缺失或错误时调用会收到明确的 401 错误提示 |

## 日常运维

| 操作 | 命令 |
| --- | --- |
| 查看日志 | `docker compose logs -f` |
| 停止（保留登录态） | `docker compose down` |
| 重置登录 | `docker compose down && rm data/cookies.json && docker compose up -d`，再重新扫码 |

## 升级

升级到上游新 commit 前，必须先重新走安全审查（隐藏指令 / 外部调用 / 密钥），审查通过后更新本 README 与 `docker-compose.yml` 中的 commit 号，重新 `git checkout <新commit> && docker compose up -d --build`。不审查不升级。
