# 技术方案：自媒体运营工作台（小红书 · 热点获取）

- 状态：已批准（2026-11-07）
- 作者：TechLead Bot
- 依据：docs/PRD.md（已批准 2026-11-07）；本轮试跑无设计阶段，DESIGN.md 留草稿，PRD 直接进技术方案

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
