#!/usr/bin/env bash
# 创建工作流标签。标签就是状态机：agent:ready -> agent:in-progress -> agent:review -> done
# 用法：GH_REPO=owner/name ./scripts/setup-labels.sh
set -euo pipefail

label() { gh label create "$1" --color "$2" --description "$3" --force; }

label "agent:ready"       "0E8A16" "TechLead 已拆好，可交给编程智能体"
label "agent:in-progress" "FBCA04" "编程智能体正在做"
label "agent:review"      "1D76DB" "PR 已提交，等 TechLead 验收"
label "done"              "5319E7" "已合并并验收"
label "needs-decision"    "D93F0B" "需要人做决定；TechLead 先看，产品决策转 Chief 问你"
label "observe"           "C5DEF5" "主动发现的建议，观察期只记录不执行"
label "spec"              "BFD4F2" "需求或设计讨论，尚未拆成工作单元"
