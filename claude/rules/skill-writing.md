---
paths: **/skills/**
---

# Skill 寫作原則

**核心**：skill 自包含跨工具可用，不綁 Claude Code 專屬機制，規則不在多處重複。

**做法**：

- subagent 一律 `Agent` + `subagent_type: "general-purpose"`，prompt = `references/*.md` 全文 + 本次需求（不要叫 subagent 自己 Read）
- 工具限制等規則寫在 references 正文，自包含、不引用命名 agent
- 補 fallback 條款：「無 Agent 工具時主 agent 直接 Read references 跑同一流程」

**避免**：

- `.claude/agents/` 新增命名 agent（Claude Code 專屬，跨工具不可移植）
- SKILL.md 與 references 重複定義（必漂移）
- 規則只寫 frontmatter（fallback 路徑看不到）
