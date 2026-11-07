# 项目仓库模板

DS Bot 小团队负责的项目仓库。第一次用时，把本目录改名为你的项目名，或者用 `ds-bot-team/scripts/bootstrap-github.sh <project-name>` 直接创建 GitHub 仓库。

## 谁写什么

| 文件 | 作者 | 说明 |
| --- | --- | --- |
| `docs/PRD.md` | PM Bot | 需求、优先级、验收标准、命名表 |
| `docs/DESIGN.md` | Designer Bot | 页面结构、组件状态、设计令牌、界面文案 |
| `docs/TECH_SPEC.md` | TechLead Bot | 技术方案和工作单元拆分 |
| `docs/LAUNCH.md`、`docs/ops/` | Ops Bot | 上线计划、内容、周报、反馈 |
| `docs/decisions/` | 你 / Chief | 重要决定记录，一个决定一个文件 |
| `AGENTS.md` | 你；DS Bot 自动学习提议、你批准 | 编程智能体和 Bot 每次开工都读 |
| 代码 | 编程智能体（Cursor / Claude Code） | 按 Work Unit Issue 开发，提 PR |

## 流程
  
需求 -> `docs/PRD.md`（你批准）-> `docs/DESIGN.md` -> `docs/TECH_SPEC.md` + Work Unit Issue（你批准）-> 编程智能体提 PR -> TechLead 验收 -> 你合并。

标签：`agent:ready` -> `agent:in-progress` -> `agent:review` -> `done`；卡住时加 `needs-decision`。
