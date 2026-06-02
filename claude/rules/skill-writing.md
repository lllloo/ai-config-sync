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

**跨平台執行（shell 趨近零）**：沒有單一 shell 跑遍 Windows(PowerShell)/mac(zsh)/Linux(bash)，唯一真正跨全部的是 harness-native 工具 + 跨平台語言。

- 檔案動作（存在檢查、讀、搜尋、寫、改）一律 `Read`/`Grep`/`Glob`/`Write`/`Edit`，不落 shell、不分 OS。
- 逃不掉的邏輯（跑程式、解析、聚合、外部 CLI）包進 bundled Python 腳本（`scripts/*.py`，純 stdlib），SKILL.md 只留一行呼叫——跨平台複雜度藏進 Python，呼叫行沒有 shell 方言差異。**不要**「挑一支 shell 寫死」或「宣告一律用 Bash 工具」當解法（綁 OS、Windows 預設 PowerShell 易翻車）。
- 腳本呼叫路徑：cwd 契約是 vault root，腳本在 `.agents/skills/<skill>/scripts/`，故寫**從 root 起算的完整相對路徑**（`python3 .agents/skills/<skill>/scripts/x.py`），不是 `python3 scripts/x.py`。
- 直譯器名一律 `python3`，不留 `python` fallback：`python3` 是 mac/Linux 正規名（mac 現代版裸 `python` 直接 not found，這是 fallback 寫法害 mac 每跑一次必先失敗一次才切換的根因），Windows Store Python/conda 也都有。唯一破口是 python.org 官方 Windows installer（只建 `python.exe`/`py.exe`、無 `python3.exe`），屬已知範圍明確例外，不為它在每行加 fallback。範圍限「呼叫 stdlib-only 的 bundled 腳本」，非泛指所有 python 指令。
- 腳本 Windows 編碼：開頭 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`；所有 `subprocess.run(..., text=True)` 必加 `encoding="utf-8", errors="replace"`（否則 cp950 解碼 UTF-8 回傳會崩、`stdout` 變 None）。
- 真無法避的外部 CLI（如 obsidian CLI）：code fence 不標 `bash`，標明 shell 差異（PowerShell `obsidian` / Git Bash `Obsidian.com`）。

**跨工具可移植性（避免）**：

- `.claude/agents/` 新增命名 agent（Claude Code 專屬，跨工具不可移植）
- 依賴 Claude Code 專屬 frontmatter（如 `when_to_use`、`allowed-tools`、`disable-model-invocation`）做跨工具共用的觸發訊號——其他工具（Cursor / Codex / Gemini CLI）不認此欄位，觸發情境寫進 description 本文才 portable
- SKILL.md 與 references 重複定義（必漂移）
- 規則只寫 frontmatter（fallback 路徑看不到）
