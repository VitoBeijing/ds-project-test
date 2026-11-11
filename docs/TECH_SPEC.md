# 技术方案：自媒体运营工作台（小红书 · 主题深挖）

- 状态：已批准（第三版「主题收集 + 挖掘」，2026-11-10）
- 作者：TechLead Bot
- 变更记录：
  - v1（已批准 2026-11-07，已作废）：热点获取——热搜榜方向
  - v2（已批准 2026-11-09，已作废）：真实数据源接入——仍基于热搜榜
  - v3（已批准 2026-11-10）：主题深挖——主题关键词检索 → 内容簇 → 高价值挖掘 → 深度报告
  - v3.1（已批准 2026-11-11）：新增 US-6「登录集成到工作台」——页内展示登录二维码、扫码自动检测登录态
- 依据：docs/PRD.md（v3，2026-11-10）；DESIGN.md 留草稿，PRD 直接进技术方案

## 概述

本轮只交付「热点获取」模块：单用户、无需登录的本地 Web 工作台。用户打开「热点看板」页面，看到一份非空的小红书主题热点列表（每条含主题名、热度或排名、更新时间），系统按设定频率（默认每 1 小时）自动刷新，也支持「手动刷新按钮」立即刷新。

技术选型（仓库为空，本方案首次定义，作为后续真相源）：

| 层 | 选型 |
| --- | --- |
| 语言/运行时 | Node.js 20 + TypeScript 5 |
| 后端 | Express 4 + better-sqlite3（本地文件库，单用户无需外部数据库） |
| 前端 | React 18 + Vite + TypeScript（单页「热点看板」） |
| 测试 | Vitest + React Testing Library；Playwright 作为后续可选的 E2E |
| 包管理 | pnpm workspace：根 + `server/` + `web/` |
| 调度 | 服务端定时器（默认每 1 小时，`REFRESH_INTERVAL_MINUTES` 可配置） |

数据来源方向采用「Provider 适配层」隔离：首个可运行版本用 `FixtureProvider`（本地样例数据，保证可测试、无外部依赖）；真实合规来源（官方 / 第三方）作为后续工作单元，接入前须先做合规确认（见「未决问题」）。

## 架构

```
热点看板（web/ React）
   │  GET /api/hot-topics
   │  POST /api/hot-topics/refresh
   ▼
server/ Express API（热点获取模块）
   │
   ├── 调度器 scheduler（每 1 小时触发） ──┐
   │                                        ▼
   └── hotspot 服务（抓取 + 落库） ◀── Provider 适配层（FixtureProvider / 后续真实源）
                                            │
                                            ▼
                                    存储 store（SQLite `topics` 表）
```

职责划分：

- **web/**：`热点看板` 页面；组件按 PRD 命名表实现——`热点列表`、`热点条目`、`手动刷新按钮`；空状态、错误状态。
- **server/**：
  - `store`：SQLite 读写，`topics` 表。
  - `provider`：`HotTopicProvider` 接口 + `FixtureProvider` 实现（返回非空样例热点）。
  - `service`：一次「抓取 → 归一 → 落库」的编排，供调度器与手动刷新共用。
  - `scheduler`：按 `REFRESH_INTERVAL_MINUTES`（默认 60）定时调用 service。
  - `api`：`GET /api/hot-topics`、`POST /api/hot-topics/refresh`。

模块名「热点获取」、页面名「热点看板」、组件名「热点列表 / 热点条目 / 手动刷新按钮」沿用 PRD 命名表，不得改字。

## 数据结构与接口

### 数据模型（SQLite `topics` 表）

```sql
CREATE TABLE topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,       -- 主题名
  rank        INTEGER,             -- 排名（可选，与 heat 至少其一）
  heat        INTEGER,             -- 热度（可选，与 rank 至少其一）
  category    TEXT,                -- 领域/主题（US-4 预留，本轮可为空）
  source      TEXT NOT NULL,       -- 数据来源标识，如 'fixture'
  fetched_at  TEXT NOT NULL,       -- 本次抓取时间（ISO 8601），即“更新时间”
  UNIQUE (title, source)
);
```

约束：每条热点 `rank` 与 `heat` 至少其一非空（PRD「热度或排名」）；列表的「更新时间」取最近一次抓取的 `fetched_at`。

### HTTP 接口（server/api）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/hot-topics` | 返回最新列表；空数据返回 `{ topics: [], fetchedAt: null }`，前端据此显示空状态 |
| POST | `/api/hot-topics/refresh` | 立即抓取一次并落库，返回最新列表与 `fetchedAt` |

`GET /api/hot-topics?category=<name>` 为 US-4（主题筛选）预留，本轮不实现。

Topic 响应示例：

```json
{
  "id": 1,
  "title": "夏日穿搭",
  "rank": 1,
  "heat": 980000,
  "category": null,
  "source": "fixture",
  "fetchedAt": "2026-11-07T08:00:00.000Z"
}
```

### 内部接口（Provider 适配层）

```ts
// 原始热点，不含 fetchedAt/source（由 service 统一归一）
interface ProviderTopic {
  title: string;
  rank?: number;
  heat?: number;
  category?: string;
}

interface HotTopicProvider {
  readonly name: string;          // 如 'fixture'
  fetch(): Promise<ProviderTopic[]>;
}
```

对已有接口无影响（仓库为空，无既有接口）。

## 风险与取舍

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 小红书无官方公开的热搜 API；第三方数据平台需账号/密钥且有合规风险 | 无法直接获得“真实新鲜”热点 | 用 Provider 适配层隔离数据源；首版 FixtureProvider 满足“列表非空 + 字段完整”的可观察验收；真实来源接入前先做合规确认（产品/合规决策，交 Chief） |
| 定时任务单进程内 setInterval，进程重启会丢调度 | 自动刷新可能中断 | 启动时立即抓取一次 + 记录上次抓取时间；单用户本地场景可接受，后续可换系统级调度 |
| 热度/排名口径不统一（不同来源字段含义不同） | 展示含义歧义 | 数据模型同时保留 rank/heat 且至少其一；口径在真实来源接入时统一 |
| US-4「主题筛选」依赖领域标签，而平台级热搜可能无领域字段 | 筛选功能落空 | 本轮不实现 US-4；`category` 字段预留，待 PRD 未决问题#1 确认后启用 |

## 测试策略

- 单元测试：`store`（读写、去重、空态）、`provider`（Fixture 返回非空且字段合法）、`service`（抓取→落库编排）、`api`（列表/手动刷新、空数据返回 `fetchedAt: null`）。
- 组件测试：`热点列表` 渲染、`热点条目` 字段展示、`手动刷新按钮` 点击触发、空状态/错误状态文案。
- 手工验证：启动后打开「热点看板」确认列表非空；等一个刷新周期或点「手动刷新」确认「更新时间」变化；临时让 provider 返回空数据确认空状态。
- 每个工作单元的测试命令见其 Issue；改了界面必须附真实前后对比截图（PRD 验收 + 项目 PR 模板要求）。

## 工作单元拆分

每个工作单元对应一个 Work Unit Issue，小到一个 PR 能完成；依赖顺序线性：WU-1 → WU-2 → WU-3 → WU-4。

| 编号 | 工作单元 | 依赖 | Issue |
| --- | --- | --- | --- |
| WU-1 | 项目脚手架 + 数据模型与存储层（pnpm workspace、`topics` 表、store 读写） | — | #1 |
| WU-2 | 数据源适配层 + FixtureProvider（Provider 接口 + 样例源，返回非空热点） | WU-1 | #2 |
| WU-3 | 定时自动刷新 + 手动刷新 + REST API（scheduler + service + 两个端点） | WU-2 | #3 |
| WU-4 | 热点看板 UI（列表 / 条目 / 手动刷新按钮 / 空·错误态） | WU-3 | #4 |

US-4（主题筛选，P1，PRD 标注“待确认后启用”）本轮不建 Issue，待 PRD 未决问题#1 确认后另拆。

## 未决问题

- [产品/合规] 真实热点数据来源方向（官方 vs 第三方 vs 公开榜单）——PRD 未决问题#4。本方案先用 FixtureProvider 不阻塞开发，真实来源接入需 Chief 用 ask_user 与用户确认合规方向，确认后我再拆 WU。
- [范围] US-4「主题筛选」何时启用——PRD 未决问题#1 推荐“先做平台级热搜榜，赛道筛选作为下一步”，本方案按此默认执行；若用户要提前，交给 Chief。

---

# 第二轮：真实数据源接入（v2）

- 状态：已批准（2026-11-09）
- 依据：docs/PRD.md v2「真实数据源接入」；用户明确「爬虫 / 浏览器自动化 + 自有小红书账号，暂缓合规、先跑通」

## 概述

把第一轮的 `FixtureProvider` 换成真实小红书热点：用 Playwright 浏览器自动化 + 用户小红书账号的登录会话，抓取小红书当前真实热点，经「抓取 → 归一 → 落库」链路写进 `topics` 表，让「热点看板」展示真实数据。合规按 PRD「暂缓合规、先跑通」声明执行。

## 技术选型增量

| 项 | 选型 |
| --- | --- |
| 浏览器自动化 | Playwright（chromium），服务端驱动 |
| 登录会话 | 持久化浏览器 profile（`userDataDir`）复用登录态，不存账密明文 |
| 数据源 | 「真实热点源」模块 = `XiaohongshuProvider`，实现 `HotTopicProvider`，`name='xiaohongshu'` |
| 依赖 | `server/` 新增 `playwright`；`FixtureProvider` 保留作测试 / 降级 |

## 架构增量

```
热点看板（web/ React）
   │  GET /api/hot-topics       GET /api/hot-topics/source
   │  POST /api/hot-topics/refresh
   ▼
server/ Express API（热点获取 + 真实热点源）
   │
   ├── scheduler ──► service ──► Provider 适配层
   │                                ├── XiaohongshuProvider（真实热点源，Playwright 抓取）
   │                                └── FixtureProvider（测试 / 降级）
   └── 登录入口（headed 浏览器手动登录）→ 持久化 profile：server/data/xhs-profile/
```

## 数据结构

- `topics` 表不变；`source` 新增取值 `'xiaohongshu'`。
- 登录会话由浏览器 profile 目录持久化（`server/data/xhs-profile/`，已 gitignore），不新增数据库表、不存账密。

## HTTP 接口增量

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/hot-topics/source` | 返回 `{ source: 'xiaohongshu'\|'fixture', loggedIn: boolean, lastFetchedAt: string\|null }`，前端据此显示「需要登录」提示 |
| POST | `/api/hot-topics/refresh` | 语义不变；会话失效时返回 401 `{ error: '需要登录' }`，前端提示重新登录 |

登录本身不提供账密表单：手动 `pnpm -C server login` 打开 headed 浏览器到小红书登录页，用户登录后会话落盘到 profile 目录。

## 登录与会话

- 手动登录：`pnpm -C server login` → headed 浏览器 → 用户登录 → cookie 落 `server/data/xhs-profile/`。
- 抓取：`XiaohongshuProvider` 用同一 profile 启动浏览器，检测登录态；未登录抛「需要登录」。
- 会话失效：抓取时被跳转到登录页 / 无登录态 → 抛「需要登录」→ API 401 → 前端提示重新登录，不静默失败、不用样例冒充真实数据。

## 抓取与字段映射

- 抓取目标：小红书「发现 / 热搜」页，抓取主题名、排名、热度。
- 字段映射：主题名→`title`；排名→`rank`；热度→`heat`（平台无独立热度值时 `heat` 留空，仍满足「热度或排名」）；`category` 暂空（US-4 后置）。
- 抓取频率：沿用 `REFRESH_INTERVAL_MINUTES`（默认 60 分钟，低频观察风控）。

## 风险与取舍

| 风险 | 应对 |
| --- | --- |
| 账号风控 / 封号（高频抓取） | 沿用低频（默认 1 小时）；单用户本地；PRD 合规声明「暂缓、先跑通」 |
| 小红书页面结构变化 → 选择器失效 | 选择器集中在 Provider 内定义；抓取失败返回明确错误，不静默 |
| 会话失效 | 登录态检测 + 401 + 前端「需要登录」提示 |
| 合规 | PRD 已声明暂缓；对外 / 上线前须另行做合规与账号安全评估 |

## 测试策略

- `XiaohongshuProvider`：用离线 fixture HTML 或 mock Playwright 单测，覆盖字段映射、未登录检测、空结果，不依赖真实网络 / 账号。
- 会话状态端点：`loggedIn` 判断、401 分支。
- 组件测试：看板「需要登录」提示、真实来源标识、会话失效「重新登录」提示。
- 手工验收：手动登录 → 看板显示真实热点；登出 → 看板提示重新登录。

## 工作单元拆分（线性依赖）

| 编号 | 工作单元 | 依赖 | Issue |
| --- | --- | --- | --- |
| WU-5 | 浏览器自动化基建 + 登录会话（Playwright 持久化 profile、`pnpm -C server login` 入口、登录态检测 + `GET /api/hot-topics/source`） | WU-4 | #13 |
| WU-6 | 真实热点源 Provider（`XiaohongshuProvider` 抓取真实热点 + 字段映射，接入 service 作为主源，Fixture 降级） | WU-5 | #14 |
| WU-7 | 前端登录状态与真实来源提示（看板「需要登录」、会话失效重新登录、真实来源标识） | WU-6 | #15 |

## 合规声明

本轮经用户明确要求「暂不考虑信息合规问题，先跑通流程」，采用爬虫 / 浏览器自动化 + 用户自有账号。对外使用或上线前须另行做合规与账号安全评估。

## 未决问题（沿用 PRD 未决问题，不阻塞）

- 登录方式：手动登录 + 复用浏览器会话（推荐，不接触账密明文）。
- 抓取目标页与选择器：实现时按当前小红书页面结构确定，需真机调试。
- 抓取频率：沿用默认每 1 小时。

---

# 第三版：主题深挖（v3）

- 状态：已批准（2026-11-10）
- 依据：docs/PRD.md v3「主题深挖」第一版（收集 + 挖掘）

## 概述

方向从「热搜榜」转向「主题深挖」：用户输入主题关键词，系统经 xiaohongshu-mcp 检索小红书相关内容、构建内容簇、挖掘高价值内容，产出主题深度报告。第一版只做「收集 + 挖掘」；图文生成、发布放第二版。热搜榜方向作废。

## 技术选型

| 层 | 选型 |
| --- | --- |
| 数据源 | 开源 xiaohongshu-mcp（Go 二进制/MCP 服务），`search_feeds` 关键词检索 + `get_feed_detail` 详情 + QR 登录 cookie 持久化 |
| 后端 | 复用现有 Node 20 + TS + Express；新增 MCP 客户端封装调用 xiaohongshu-mcp |
| 前端 | 复用 React 18 + Vite；新增「主题工作台」页面 |
| 存储 | better-sqlite3，新增 themes/notes/clusters/reports 表 |
| 高价值挖掘 | 互动数据加权（点赞×1 + 收藏×2 + 评论×3）排序取 top N（默认 10） |

## 架构

```
主题工作台（web/ React）
   │  POST /api/themes/collect
   │  GET  /api/themes/:id/report
   ▼
server/ Express API
   │
   ├── theme 服务（collect → 内容簇 → 高价值挖掘 → 报告）
   │
   └── 数据源适配层 XhsMcpClient（MCP 客户端）
         └──► xiaohongshu-mcp（独立进程，HTTP MCP :18060）
                ├── search_feeds（关键词检索）
                ├── get_feed_detail（详情/互动数据）
                └── check_login_status / QR 登录（登录态由它管理）
```

## 数据结构（SQLite）

```sql
CREATE TABLE themes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT NOT NULL,
  status     TEXT NOT NULL,   -- collecting / done / failed
  created_at TEXT NOT NULL
);
CREATE TABLE notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id      INTEGER NOT NULL REFERENCES themes(id),
  feed_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  author        TEXT,
  like_count    INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  tags          TEXT,         -- JSON 数组
  published_at  TEXT,
  url           TEXT,
  UNIQUE (theme_id, feed_id)
);
CREATE TABLE clusters (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  label    TEXT NOT NULL      -- 簇名（话题标签/关键词）
);
CREATE TABLE cluster_notes (
  cluster_id INTEGER NOT NULL REFERENCES clusters(id),
  note_id    INTEGER NOT NULL REFERENCES notes(id)
);
CREATE TABLE reports (
  theme_id         INTEGER PRIMARY KEY REFERENCES themes(id),
  cluster_summary  TEXT,      -- JSON
  high_value_notes TEXT,      -- JSON（top N）
  conclusion       TEXT,
  generated_at     TEXT
);
```

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/themes/collect` | body `{ keyword }`；触发检索→详情→落库→簇→挖掘→报告，返回 `themeId` |
| GET | `/api/themes/:id/report` | 返回深度报告（内容簇概览 + 高价值内容清单 + 挖掘结论）|
| GET | `/api/themes/:id/notes` | 返回该主题内容条目列表（供内容簇展示）|
| GET | `/api/mcp/status` | 返回数据源/登录状态（透传 xiaohongshu-mcp `check_login_status`）|

## 内容簇构建

- 以 `search_feeds` 结果为基础，按笔记的话题标签（tags）粗分组；无标签的归入「其他」簇。
- 内容簇概览：每个簇的名称、条目数、代表关键词。

## 高价值内容挖掘

- 判定标准：互动数据加权 `score = like_count*1 + collect_count*2 + comment_count*3`，降序取 top N（默认 10）。
- 挖掘结论：规则生成摘要（最高互动簇、top 内容的共同标签、平均互动量）。

## 数据源集成（xiaohongshu-mcp）

- xiaohongshu-mcp 作为独立进程运行（Go 二进制，HTTP MCP `http://127.0.0.1:18060/mcp`）。
- 服务端新增 `XhsMcpClient`（Node MCP 客户端或 HTTP 直调），封装 `search_feeds`、`get_feed_detail`、`check_login_status`。
- 登录：复用 xiaohongshu-mcp 的 QR 登录 + cookie 持久化（`cookies/` 目录），不存账密；未登录时 `/api/mcp/status` 返回需要登录，前端提示。
- 规模上限：每个主题默认检索 top 30 条（PRD 未决问题#4 默认值）。

## 风险与取舍

| 风险 | 应对 |
| --- | --- |
| xiaohongshu-mcp 为外部开源，可能有隐藏指令/外部调用/密钥 | 导入前先审查（PRD 未决问题#7）；审查后由用户批准导入 |
| xiaohongshu-mcp 需独立部署（Go 二进制，首次下载无头浏览器 ~150MB）| 作为前置依赖文档化；`/api/mcp/status` 暴露健康状态 |
| 内容簇聚类粗糙（仅按标签分组）| v1 先按标签粗分；后续可换语义聚类 |
| 挖掘结论规则生成较浅 | v1 规则版；后续可接 LLM 做语义摘要 |
| 热搜榜方向作废，旧 topics/hot-topics 代码 | 保留不删（避免破坏），新模块独立；后续清理 |

## 测试策略

- `XhsMcpClient`：mock MCP 响应单测 search/detail/status，不依赖真实网络。
- theme 服务：用离线 fixture 笔记数据测「检索→落库→簇→挖掘→报告」全链路；加权评分、top N、空态、失败分支。
- 组件测试：主题工作台渲染、主题输入框、开始收集按钮、内容簇/条目展示、高价值列表、深度报告、空/错误态。
- 手工验收：QR 登录 → 输入主题 → 看报告；检索不到时看空态。

## 工作单元拆分（线性依赖）

| 编号 | 工作单元 | 依赖 | Issue |
| --- | --- | --- | --- |
| WU-1 | xiaohongshu-mcp 数据源适配层（`XhsMcpClient` 封装 search_feeds/get_feed_detail/check_login_status + 登录状态透传） | — | #18 |
| WU-2 | 主题收集 + 存储 + 内容簇构建（collectTheme：检索→详情→落库→簇，SQLite 表） | WU-1 | #19 |
| WU-3 | 高价值挖掘 + 深度报告 + API（加权评分→topN→报告 + 四个端点） | WU-2 | #20 |
| WU-4 | 主题工作台 UI（主题输入框/开始收集按钮/内容簇/内容条目/高价值内容列表/深度报告） | WU-3 | #21 |
| WU-5 | 登录集成到工作台（页内登录二维码 + 扫码自动检测登录态 + 失效提示重登） | WU-4 | #28 |

US-5（并行多主题，P1）第一版不建 Issue，待 PRD 未决问题#3 确认。

## 登录集成到工作台（US-6，v3.1）

- 数据源登录态由 xiaohongshu-mcp 管理；工作台页内完成登录，不离开页面、不弹文件。
- 服务端 `XhsMcpClient` 新增 `getLoginQrcode()`：调用 MCP 工具 `get_login_qrcode`（生成二维码属只读操作，加入只读白名单），返回二维码图片 base64 与过期时间；已登录时返回登录态。
- 新增端点 `GET /api/mcp/login-qrcode`：未登录返回二维码图片；已登录返回 `{ loggedIn: true }`。
- 复用 `GET /api/mcp/status` 轮询登录态：扫码成功后自动检测并切换已登录。
- 前端组件（命名表原样）：「登录按钮」触发页内展示二维码；「登录二维码」页内扫码，轮询登录态，过期可重取。
- 登录态失效（collect 401 / status loggedIn:false）提示重新登录，不静默失败。

## 合规声明

沿用用户「暂缓合规、先跑通流程」语境；xiaohongshu-mcp 为外部开源，导入前须经审查（隐藏指令/外部调用/密钥）。对外使用或上线前须另行做合规与账号安全评估。

## 未决问题（沿用 PRD 未决问题，不阻塞）

- 高价值判定标准：互动加权（点赞×1 + 收藏×2 + 评论×3）取 top 10，默认值，后续可调。
- 内容规模上限：每主题默认 30 条。
- 并行多主题（US-5）：第一版先单主题，多主题放后续。
- xiaohongshu-mcp 导入前须经代码审查，审查后用户批准导入。
