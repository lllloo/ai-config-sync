---
paths: **/skills/**
---

# Skill 寫作原則

**核心**：憲法級／跨 skill 共用規則集中在 `CLAUDE.md`（有 `AGENTS.md` symlink，Cursor / Codex / Gemini CLI 等啟動時也讀得到）。SKILL.md 主流程靠這份憲法，只寫該 skill 自己的程序——**不重述憲法、不寫「見 CLAUDE.md」指回**。唯 `references/*.md`（subagent prompt）需自包含：subagent 不保證載入 AGENTS.md。不綁 Claude Code 專屬機制，規則不在多處重複。

**通則**：description 寫法、frontmatter 規格、progressive disclosure 等請依 `/skill-creator` 與 [Anthropic 官方 best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)，本檔不重複。

**本專案約束**：

- subagent 一律 `Agent` + `subagent_type: "general-purpose"`，prompt = `references/*.md` 全文 + 本次需求（不要叫 subagent 自己 Read）
- 工具限制等規則寫在 references 正文，自包含、不引用命名 agent
- 補 fallback 條款：「無 Agent 工具時主 agent 直接 Read references 跑同一流程」
- SKILL.md 主流程不寫憲法級規則（不自動 commit、通用 wikilink/frontmatter、卡片盒升級流程等）——這些在 `CLAUDE.md`，不重述也不指回
- 但 subagent 經 `references/*.md` 執行時要遵守的寫作規則（繁中、時間抗性等）必須在該 prompt 內可達（inline 或叫它先讀 AGENTS.md），不能只靠 AGENTS.md

**跨工具可移植性（避免）**：

- `.claude/agents/` 新增命名 agent（Claude Code 專屬，跨工具不可移植）
- 依賴 Claude Code 專屬 frontmatter（如 `when_to_use`、`allowed-tools`、`disable-model-invocation`）做跨工具共用的觸發訊號——其他工具（Cursor / Codex / Gemini CLI）不認此欄位，觸發情境寫進 description 本文才 portable
- SKILL.md 與 references 重複定義（必漂移）
- 規則只寫 frontmatter（fallback 路徑看不到）
