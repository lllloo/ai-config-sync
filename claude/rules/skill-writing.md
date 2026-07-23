---
paths: **/skills/**
---

# Skill 寫作原則

**核心**：憲法級／跨 skill 共用規則集中在 `CLAUDE.md`。各專案根放 `AGENTS.md → CLAUDE.md` symlink（如 vault repo），Codex 等支援 `AGENTS.md` 慣例的工具從**專案根**讀得到（Cursor 原生走 `.cursor/rules/`、Gemini CLI 預設 `GEMINI.md`，是否認 `AGENTS.md` 各自確認、別預設三者皆可）；全域 `~/.claude/` 不靠此機制跨工具共用。SKILL.md 主流程靠這份憲法，只寫該 skill 自己的程序——**不重述憲法、不寫「見 CLAUDE.md」指回**。唯 `references/*.md`（subagent prompt）需自包含：subagent 不保證載入 AGENTS.md。不綁 Claude Code 專屬機制，規則不在多處重複。

**通則**：description 寫法、frontmatter 規格、progressive disclosure 等請依 `/skill-creator` 與 [Anthropic 官方 best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)，本檔不重複。

**跨平台執行（shell 趨近零）**：沒有單一 shell 跑遍 Windows(PowerShell)/mac(zsh)/Linux(bash)，唯一真正跨全部的是 harness-native 工具 + 跨平台語言。

- 檔案動作（存在檢查、讀、搜尋、寫、改）一律 `Read`/`Grep`/`Glob`/`Write`/`Edit`，不落 shell、不分 OS。
- 逃不掉的邏輯（跑程式、解析、聚合、外部 CLI）包進 bundled Python 腳本（`scripts/*.py`，純 stdlib），SKILL.md 只留一行呼叫——跨平台複雜度藏進 Python，呼叫行沒有 shell 方言差異。**不要**「挑一支 shell 寫死」或「宣告一律用 Bash 工具」當解法（綁 OS、Windows 預設 PowerShell 易翻車）。
- 腳本呼叫路徑：以 skill 宣告的 cwd 契約（通常是 repo root）為基準，寫**從 root 起算的完整相對路徑**（`python3 .agents/skills/<skill>/scripts/x.py`），不是 `python3 scripts/x.py`。全域 skill 的基準是其安裝根（`~/.agents/skills/<skill>/`），非 repo root，別把本地相對路徑照抄。
- 直譯器名一律 `python3`，不留 `python` fallback：`python3` 是 mac/Linux 正規名（mac 現代版裸 `python` 直接 not found，這是 fallback 寫法害 mac 每跑一次必先失敗一次才切換的根因），Windows Store Python/conda 也都有。唯一破口是 python.org 官方 Windows installer（只建 `python.exe`/`py.exe`、無 `python3.exe`），屬已知範圍明確例外，不為它在每行加 fallback。範圍限「呼叫 stdlib-only 的 bundled 腳本」，非泛指所有 python 指令。
- 腳本 Windows 編碼：依 `python.md`（reconfigure stdout/stderr、subprocess 與 `open()` 顯式 `encoding`），此處不重述。
- 真無法避的外部 CLI（如 obsidian CLI）：code fence 不標 `bash`，標明 shell 差異（PowerShell `obsidian` / Git Bash `Obsidian.com`）。

**跨工具可移植性（避免）**（呼應全域 `CLAUDE.md`「一律用 skill、不新增 command」政策，以下為實作守則）：

- `.claude/agents/` 新增命名 agent（Claude Code 專屬，跨工具不可移植）
- 依賴 Claude Code 專屬 frontmatter（如 `when_to_use`、`allowed-tools`、`disable-model-invocation`）做跨工具共用的觸發訊號——其他工具（Cursor / Codex / Gemini CLI）不認此欄位，觸發情境寫進 description 本文才 portable。**例外**：刻意僅限 Claude Code、不要求跨工具觸發的 skill（如 `ob-*` 用 `disable-model-invocation` gate 人工觸發）不在此限
- SKILL.md 與 references 重複定義（必漂移）
- 規則只寫 frontmatter（fallback 路徑看不到）

**skill 放哪（實體來源 vs 探索橋）**：本地跨工具 skill 的實體來源是 `.agents/skills/<name>/`（真實體、Codex 原生掃、納版控），`.claude/skills` 只是 Claude Code 的 symlink 探索橋（→ `.agents/skills`）。**不要**把 skill 直接放進 `.claude/skills/`——那會綁 Claude-only、脫離跨工具實體來源。同一原則在 `~/` 全域尺度亦然（`~/.agents/skills` 實體來源 + `~/.claude/skills/<name>` symlink 橋）；全域那層可能由同步工具或 `npx skills` 代管，機制隨環境而定、不在本檔展開。
