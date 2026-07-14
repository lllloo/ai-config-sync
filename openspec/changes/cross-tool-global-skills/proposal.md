# Proposal：跨工具全域 skill（Claude Code + Codex）

## Why

repo 自寫的全域 skill（`bmad-run-story`、`mini-research`、`pen-design`）目前由 `sync.js` 從 `claude/skills/` 直接鏡射進 `~/.claude/skills/`，**只有 Claude Code 看得到**。同一批 skill 對 Codex 不可見，因為 Codex 全域只掃 `~/.agents/skills/`（見 CLAUDE.md「Codex 本地 skill」節與 `core-skills/src/loader.rs`）。

生態早已有跨工具的正確作法：`npx skills add -g` 把 skill 實體裝進 `~/.agents/skills/`（正典），再 symlink 進 `~/.claude/skills/` 供 Claude Code 探索。我們的 repo-authored skill 是唯一繞過這套機制、綁死 Claude 的異類。

**目標**：讓 repo 自寫的全域 skill 對 Claude Code 與 Codex 同時可見，且與 `npx skills` 的既有機制同軌、不互相破壞。

## 已釘死的前提（探索結論）

- **A-lite 出局**：Claude Code 官方探索路徑只有 `~/.claude/skills/`（personal）與 `.claude/skills/`（project），**不含 `~/.agents/skills/`**。來源：<https://code.claude.com/docs/en/skills> 探索路徑表。
- **A-full 官方支援**：同份文件明載 personal 位置的 `<skill-name>` entry「can be a symlink to a directory elsewhere on disk」，Claude Code 會跟隨並讀取，且同一 target 多處可達時只載入一次（自動去重）。symlink 橋不是 hack。
- **Codex 鎖定 `~/.agents/skills/`**：想讓 Codex 看到，正典**只能**放這裡，無替代目錄。

## What Changes

1. **新增 repo 同步區 `agents/`**（無點），對應 `~/.agents/`，與 `claude/`↔`~/.claude/`、`codex/`↔`~/.codex/` 同構。跨工具全域 skill 放 `agents/skills/<name>/`。
   - `claude/skills/` 保留給「只給 Claude」的全域 skill。
   - `.agents/skills/`（有點）維持本地、專案內、不變。
   - 「哪些 skill 跨工具」用**目錄位置**分類，不加 per-skill flag。

2. **新增一個共管安全的 skill 同步型別**（暫名 `xtool-skills`），因為 `~/.agents/skills/` 與 `npx skills` **共管**，現有 `dir` 型的 prune-extras 語意會誤刪 npx 裝的 skill。新型別需具備：
   - **非 prune 的「只認名」upsert**：只處理 repo `agents/skills/` 列出的 skill 名，dest 內其他項（npx 的住戶）一律不動、絕不刪。
   - **建立 `~/.claude/skills/<name>` symlink** 指向 `~/.agents/skills/<name>`，供 Claude Code 探索。
   - `to-repo` 反向時同樣只讀回受管名字，不吸入 npx 住戶。

3. **文件與測試同步**：README 同步項目表、CLAUDE.md 目錄命名節、drift-guard 測試、沙箱整合測試（apply/boundary）。

## Non-Goals

- 不動 `.agents/skills/`（本地專案 skill）的行為。
- 不把 repo-authored skill 改成「push github → `npx skills` 安裝」的來源模式（B2 方案，另案評估）。
- 不解決 opencode 的 skill 探索（opencode 是否讀 skill、讀哪、尚未查證）。

## 已查證（原 open question 收斂）

- **③ Codex 地基成立**：`openai/codex` `loader.rs:335-339` 確認 Codex 把 `~/.agents/skills/` 當 User scope root 掃、讀真實目錄。跨工具前提無誤。
- **T2 大幅降險**：PR #743 為加法型 restore（restores lock 內正典、recreates links），diff 無 prune 未登記項邏輯,測試明載「without disturbing overlapping project-scoped skills」。未登記住戶不被刪。**保留**於 #743 merge 時複驗，不再阻塞。

## 仍未決

- **遷移**：現有真實目錄 skill → symlink 的一次性破壞性轉換（見 design D5）。
- **同名碰撞守門**：與 npx 既有 skill 撞名的偵測（見 design D6）。
- **Windows symlink**：優先評估 junction（免開發者模式）；見 design 未決節。
- **opencode**：skill 探索是否納入（Non-Goal）。
